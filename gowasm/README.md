# xOS Go runtime (Terminal room)

Real Go execution, self-hosted, zero external network calls at runtime —
same philosophy as `public/pyodide/` (Python) and `public/ruby/` (Ruby).

Instead of shipping a full Go compiler to WASM (no maintained option exists
today — TinyGo doesn't target itself, and Go's own compiler isn't built for
browser use), this embeds **yaegi** (github.com/traefik/yaegi, Apache-2.0),
a pure-Go Go *interpreter*. It covers the same "run a snippet, see the
output" use case as the Python/Ruby REPLs, using real Go semantics and the
real Go standard library — not a transpiler or a subset re-implementation.
Known gap vs. a real compiler: no cgo, no goroutine-heavy programs that need
true OS threads (yaegi runs on top of the Go runtime already inside the
WASM binary, so basic goroutines/channels work, but anything relying on
select-heavy scheduling fidelity or reflection edge cases can differ from
`go build`).

## Rebuilding xos-go.wasm

```sh
cd gowasm
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o ../public/gowasm/xos-go.wasm main.go
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../public/gowasm/wasm_exec.js
```

Only re-run this if `main.go` changes or yaegi is upgraded — the built
`.wasm` is committed to `public/gowasm/` like Pyodide's and Ruby's runtime
files, so a normal `npm run build` never needs a Go toolchain.
