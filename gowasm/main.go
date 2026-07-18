// xOS Go runtime — compiled to WASM, self-hosted, no network calls at
// runtime. See README.md for why this is an interpreter (yaegi) rather
// than a real compiler, and what that trades away.
package main

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"syscall/js"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

// commonPackages backs a small REPL convenience: `fmt.Println("hi")` should
// just work without the user typing `import "fmt"` first, the same way a
// real REPL (gore, python -i, irb) auto-imports nothing but FEELS like it
// doesn't need boilerplate. Real yaegi/Go still requires the import — we
// just inject it ourselves when it's obviously needed and not already
// present, rather than pretending Go doesn't have imports.
var commonPackages = []string{
	"fmt", "strings", "strconv", "math", "time", "os", "sort",
	"errors", "bytes", "unicode", "regexp", "encoding/json",
}

func neededImports(code string) []string {
	if strings.Contains(code, "import") {
		return nil // user is already managing imports themselves — don't fight them
	}
	var needed []string
	for _, pkg := range commonPackages {
		name := pkg
		if idx := strings.LastIndex(pkg, "/"); idx >= 0 {
			name = pkg[idx+1:]
		}
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\.`).MatchString(code) {
			needed = append(needed, pkg)
		}
	}
	return needed
}

// evalGo(code string) -> {stdout, stderr, result, error}
// Exposed as window.yaegiEval from the JS side. yaegi's Interpreter has no
// exported way to swap Stdout/Stderr after construction (only via the
// Options passed to New), so — unlike the Python/Pyodide REPL, which
// reuses one interpreter and keeps top-level state across lines — each
// call here gets a fresh interpreter. Matches the same "single statement
// at a time" scope the Python REPL already documents; this just makes the
// same tradeoff for a different reason.
func evalGo(this js.Value, args []js.Value) (result any) {
	code := args[0].String()
	var stdout, stderr bytes.Buffer

	defer func() {
		if r := recover(); r != nil {
			result = map[string]any{
				"stdout": stdout.String(),
				"stderr": fmt.Sprintf("panic: %v", r),
				"result": "",
				"error":  true,
			}
		}
	}()

	vm := interp.New(interp.Options{Stdout: &stdout, Stderr: &stderr})
	if err := vm.Use(stdlib.Symbols); err != nil {
		return map[string]any{"stdout": "", "stderr": err.Error(), "result": "", "error": true}
	}

	if needed := neededImports(code); len(needed) > 0 {
		var b strings.Builder
		b.WriteString("import (\n")
		for _, p := range needed {
			fmt.Fprintf(&b, "\t%q\n", p)
		}
		b.WriteString(")\n")
		_, _ = vm.Eval(b.String()) // best-effort — a real problem still surfaces from the eval below
	}

	v, err := vm.Eval(code)
	if err != nil {
		return map[string]any{
			"stdout": stdout.String(),
			"stderr": err.Error(),
			"result": "",
			"error":  true,
		}
	}

	resultStr := ""
	if v.IsValid() && v.CanInterface() {
		resultStr = fmt.Sprintf("%v", v.Interface())
	}
	return map[string]any{
		"stdout": stdout.String(),
		"stderr": stderr.String(),
		"result": resultStr,
		"error":  false,
	}
}

func main() {
	js.Global().Set("yaegiEval", js.FuncOf(evalGo))
	// Signal readiness AFTER the global is wired up — the JS side awaits
	// this rather than racing go.run()'s promise, which only resolves when
	// the program exits (never, because of the select{} below).
	js.Global().Set("yaegiReady", js.ValueOf(true))
	select {} // keep the Go scheduler alive so JS can keep calling back in
}
