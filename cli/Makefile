# cyberbox — Go-native CyberBox CLI
#
# Common entry points:
#   make build      build the cyberbox binary into ./dist/cyberbox
#   make test       run go test ./...
#   make vet        run go vet ./...
#   make cross      build for all release targets (smoke check; goreleaser does the real release)
#   make install    `go install` into $GOPATH/bin
#   make clean      remove ./dist
#
# Variables:
#   VERSION         git describe; passed to -ldflags for the cli version string
#   GO              `go` toolchain command (override for `richgo` etc.)

GO ?= go
DIST_DIR ?= dist
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/ProwlrBot/CyberBox/cli/cmd.Version=$(VERSION)

.PHONY: build test vet lint cross install clean

build:
	mkdir -p $(DIST_DIR)
	$(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cyberbox ./

test:
	$(GO) test -race -count=1 ./...

vet:
	$(GO) vet ./...

# `lint` is intentionally separate from `vet` — vet is the always-on baseline,
# lint is opt-in for stricter checks (golangci-lint must be installed).
lint:
	@command -v golangci-lint >/dev/null 2>&1 || { \
	  echo "golangci-lint not installed; skipping (install: https://golangci-lint.run/)"; exit 0; }
	golangci-lint run ./...

# Smoke-check that the cross-platform matrix at least compiles. The actual
# release artifacts are built by `goreleaser release`; this target just
# guards against ad-hoc development breaking Windows/ARM.
cross:
	mkdir -p $(DIST_DIR)/cross
	GOOS=linux  GOARCH=amd64 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cross/cyberbox-linux-amd64    ./
	GOOS=linux  GOARCH=arm64 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cross/cyberbox-linux-arm64    ./
	GOOS=darwin GOARCH=amd64 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cross/cyberbox-darwin-amd64   ./
	GOOS=darwin GOARCH=arm64 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cross/cyberbox-darwin-arm64   ./
	GOOS=windows GOARCH=amd64 $(GO) build -trimpath -ldflags='$(LDFLAGS)' -o $(DIST_DIR)/cross/cyberbox-windows-amd64.exe ./
	@ls -lh $(DIST_DIR)/cross

install:
	$(GO) install -trimpath -ldflags='$(LDFLAGS)' ./

clean:
	rm -rf $(DIST_DIR)
