# Common dev/build commands for the WhatsApp api service.
#
# Run targets from this directory:
#   make dev      → start with hot reload (air)
#   make build    → static binary to bin/api (for prod scp)
#   make run      → run once without hot reload (debugging)
#   make tidy     → go mod tidy
#   make test     → run all tests
#   make vet      → static analysis
#   make clean    → remove bin/ tmp/

.PHONY: dev build run tidy test vet clean

# Hot-reload dev server. Requires `air` installed:
#   go install github.com/air-verse/air@latest
dev:
	air

# Production build — static binary for Linux amd64. CGO_ENABLED=0 keeps
# it fully static (works because modernc.org/sqlite is pure Go).
build:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags='-s -w' -o bin/api ./cmd/api

# Local run without hot reload.
run:
	go run ./cmd/api

tidy:
	go mod tidy

test:
	go test ./... -race -count=1

vet:
	go vet ./...

clean:
	rm -rf bin/ tmp/

.DEFAULT_GOAL := dev
