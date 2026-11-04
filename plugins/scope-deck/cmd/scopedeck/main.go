package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/app"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/store"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/web"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "scopedeck:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	if args[0] == "version" || args[0] == "--version" {
		fmt.Printf("scopedeck %s\n", app.Version)
		return nil
	}
	if args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		usage()
		return nil
	}

	a, err := app.Open(app.Config{
		Home: os.Getenv("SCOPEDECK_HOME"),
		DB:   os.Getenv("SCOPEDECK_DB"),
		Addr: os.Getenv("SCOPEDECK_ADDR"),
	})
	if err != nil {
		return err
	}
	defer a.Close()

	switch args[0] {
	case "serve":
		return serve(a, args[1:])
	case "sync":
		return syncSource(a, args[1:])
	case "draw":
		return draw(a, args[1:])
	case "programs":
		return programs(a, args[1:])
	case "export":
		return exportScope(a, args[1:])
	default:
		return fmt.Errorf("unknown command %q (run scopedeck help)", args[0])
	}
}

func usage() {
	fmt.Print(`ScopeDeck - local target research catalog

Usage:
  scopedeck sync --source programs.json [--kind manual-json]
  scopedeck programs search <query>
  scopedeck draw [--mode surprise-me]
  scopedeck export scope --program <id>
  scopedeck serve [--bind 127.0.0.1:8321]
  scopedeck version

Environment:
  SCOPEDECK_HOME  Data directory (default: ~/.scopedeck)
  SCOPEDECK_DB    SQLite database path
  SCOPEDECK_ADDR  Web bind address (default: 127.0.0.1:8321)
`)
}

func syncSource(a *app.App, args []string) error {
	flags := flag.NewFlagSet("sync", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	source := flags.String("source", "", "source file or HTTPS URL")
	kind := flags.String("kind", "manual-json", "source adapter")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*source) == "" {
		return errors.New("sync requires --source")
	}
	result, err := a.SyncSource(*kind, *source)
	if err != nil {
		return err
	}
	return writeJSON(result)
}

func programs(a *app.App, args []string) error {
	if len(args) < 2 || args[0] != "search" {
		return errors.New("usage: scopedeck programs search <query>")
	}
	items, err := a.Search(strings.Join(args[1:], " "), 50)
	if err != nil {
		return err
	}
	return writeJSON(map[string]any{"items": items})
}

func draw(a *app.App, args []string) error {
	flags := flag.NewFlagSet("draw", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	mode := flags.String("mode", "surprise-me", "selection mode")
	if err := flags.Parse(args); err != nil {
		return err
	}
	result, err := a.Draw(store.DrawRequest{Mode: model.DrawMode(*mode), Limit: 1})
	if err != nil {
		return err
	}
	return writeJSON(result)
}

func exportScope(a *app.App, args []string) error {
	if len(args) == 0 || args[0] != "scope" {
		return errors.New("usage: scopedeck export scope --program <id>")
	}
	flags := flag.NewFlagSet("export scope", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	programID := flags.String("program", "", "program ID")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if strings.TrimSpace(*programID) == "" {
		return errors.New("export scope requires --program")
	}
	program, err := a.Program(*programID)
	if err != nil {
		return err
	}
	return writeJSON(map[string]any{
		"program_id":  program.ID,
		"program":     program.Name,
		"scope_state": program.ScopeState,
		"assets":      program.Assets,
	})
}

func serve(a *app.App, args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	bind := flags.String("bind", a.Config.Addr, "listen address")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*bind) == "" {
		return errors.New("bind address cannot be empty")
	}

	server := &http.Server{
		Addr:              *bind,
		Handler:           web.New(a).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	fmt.Printf("ScopeDeck listening on http://%s\n", *bind)
	err := server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func writeJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}
