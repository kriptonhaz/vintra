// Package storage wraps the AWS S3 client used by Go workers (currently
// for WhatsApp media — JUR-75/76). The web app has its own TS S3 helper
// at apps/web/src/lib/s3-storage.ts; both share the same bucket + IAM
// creds via env vars, with conventions kept in sync by the tagging
// scheme (kind=wa-media, kind=attendance, etc.).
//
// Why a separate Go client instead of proxying through the web app:
//   - inbound media downloads happen in the registry's whatsmeow event
//     handler, which is in Go. Posting a 5 MB image through the API
//     just to upload it to S3 from the web app would be silly.
//   - outbound sends pull bytes from S3 in the wa:send_image worker —
//     same reason, the worker is in Go.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Client is a thin wrapper around s3.Client that knows our bucket name
// and tagging conventions. Constructed lazily via NewFromEnv so binaries
// that never touch S3 (cron job, migration tool) don't need the env vars.
type Client struct {
	s3     *s3.Client
	bucket string
}

var (
	defaultClient *Client
	defaultErr    error
	defaultOnce   sync.Once
)

// Default returns a process-wide Client constructed from env vars on
// first call. Cached afterwards so concurrent callers share one
// underlying *s3.Client (the AWS SDK is goroutine-safe).
func Default(ctx context.Context) (*Client, error) {
	defaultOnce.Do(func() {
		defaultClient, defaultErr = NewFromEnv(ctx)
	})
	return defaultClient, defaultErr
}

// NewFromEnv builds a Client using AWS_REGION, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET. Missing any of those returns
// an error — we want loud failure at boot, not silent media drops.
func NewFromEnv(ctx context.Context) (*Client, error) {
	region := os.Getenv("AWS_REGION")
	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secret := os.Getenv("AWS_SECRET_ACCESS_KEY")
	bucket := os.Getenv("AWS_S3_BUCKET")
	if region == "" || accessKey == "" || secret == "" || bucket == "" {
		return nil, fmt.Errorf("storage: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET must all be set")
	}
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secret, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("storage: load aws config: %w", err)
	}
	return &Client{
		s3:     s3.NewFromConfig(cfg),
		bucket: bucket,
	}, nil
}

// Upload writes the given bytes to S3 under `key`. The `tag` argument
// drives lifecycle rules — pass "kind=wa-media" for WhatsApp media so
// the 3-day expiry rule (JUR-79) matches. Any tag value that isn't
// covered by a configured lifecycle rule means the object lives forever
// (current behavior for finance proofs, inventory photos, etc.).
//
// ContentType is what S3 returns on GET; setting it lets browsers render
// the object inline when fetched via signed URL.
func (c *Client) Upload(ctx context.Context, key string, body []byte, contentType, tag string) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(c.bucket),
		Key:          aws.String(key),
		Body:         bytes.NewReader(body),
		ContentType:  aws.String(contentType),
		Tagging:      aws.String(tag),
		CacheControl: aws.String("private, max-age=31536000"),
	})
	if err != nil {
		return fmt.Errorf("storage upload %s: %w", key, err)
	}
	return nil
}

// Get fetches the bytes at `key`. Used by the wa:send_image worker to
// pull the operator-uploaded image from S3 before sending it to
// whatsmeow. Returns an error if the object doesn't exist (caller
// should treat as a permanent failure — don't retry).
func (c *Client) Get(ctx context.Context, key string) ([]byte, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("storage get %s: %w", key, err)
	}
	defer out.Body.Close()
	buf := bytes.NewBuffer(nil)
	if _, err := buf.ReadFrom(out.Body); err != nil {
		return nil, fmt.Errorf("storage get %s read body: %w", key, err)
	}
	return buf.Bytes(), nil
}

// Bucket returns the configured bucket name. Useful for tests + telemetry.
func (c *Client) Bucket() string { return c.bucket }

// DeletePrefix lists + deletes every object under `prefix`. Used when
// a tenant deletes a WhatsApp instance — we eagerly clean up its media
// instead of waiting up to 3 days for the lifecycle rule.
//
// Best-effort: AWS limits a single Delete call to 1000 keys; we page
// through 1000 at a time. Errors mid-deletion are logged via the
// returned error, but we don't roll back partial deletes (the deleted
// objects are gone). Re-running is safe — ListObjectsV2 will return
// what's left.
func (c *Client) DeletePrefix(ctx context.Context, prefix string) (deleted int, err error) {
	for {
		list, lerr := c.s3.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(c.bucket),
			Prefix: aws.String(prefix),
		})
		if lerr != nil {
			return deleted, fmt.Errorf("list %s: %w", prefix, lerr)
		}
		if len(list.Contents) == 0 {
			return deleted, nil
		}
		ids := make([]types.ObjectIdentifier, 0, len(list.Contents))
		for _, o := range list.Contents {
			if o.Key == nil {
				continue
			}
			ids = append(ids, types.ObjectIdentifier{Key: o.Key})
		}
		out, derr := c.s3.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(c.bucket),
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if derr != nil {
			return deleted, fmt.Errorf("batch delete: %w", derr)
		}
		deleted += len(ids) - len(out.Errors)
		if len(out.Errors) > 0 {
			// Partial failure — return what succeeded so caller can log,
			// but include the first error so it's visible.
			return deleted, fmt.Errorf("partial delete: %d errors, first=%s",
				len(out.Errors), aws.ToString(out.Errors[0].Message))
		}
		// IsTruncated only matters when len(Contents) == 1000; the
		// loop natural-exits when an iteration returns < 1000.
		if !aws.ToBool(list.IsTruncated) {
			return deleted, nil
		}
	}
}

// MimeToExt picks an extension for a given MIME so the S3 key has a
// reasonable suffix (helps when a human looks at the key in the AWS
// console). Defaults to ".bin" — never errors so the upload still goes
// through.
func MimeToExt(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "application/pdf":
		return ".pdf"
	case "video/mp4":
		return ".mp4"
	case "audio/ogg", "audio/ogg; codecs=opus":
		return ".ogg"
	default:
		if i := splitOnce(mime, '/'); i > 0 && i < len(mime)-1 {
			return "." + mime[i+1:]
		}
		return ".bin"
	}
}

func splitOnce(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// PingTimeout is the deadline used by health checks that exercise the
// S3 client. Kept out of the Default() path so a flaky bucket doesn't
// block boot — health checks observe failures instead.
const PingTimeout = 2 * time.Second
