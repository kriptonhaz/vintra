/**
 * Trigger a real browser download for an image URL. The URL is expected to
 * carry `Content-Disposition: attachment` (use a download-disposition
 * signed URL on the server), so a plain anchor click downloads the file
 * on every platform — desktop, Android, iOS Safari and Brave — without
 * showing a share sheet or opening the image inline.
 */
export async function downloadImageFromUrl(
  downloadUrl: string,
  filename: string,
): Promise<void> {
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = filename
  // No `target=_blank` — that would spawn a blank tab that lingers after
  // the download starts. The Content-Disposition: attachment header makes
  // the browser download without navigating away from the current page.
  document.body.appendChild(a)
  a.click()
  a.remove()
}
