use tauri::{Emitter, Manager, Url};

#[cfg(desktop)]
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
  LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};

// Terminal room "SHELL" runtime + "RUN DEV SERVER" (Part 2): a genuine OS
// child process, not a simulated/allowlisted terminal — see the commands
// below (shell_run_sync / shell_spawn_bg / shell_kill_bg). Desktop-only for
// the same reason the browser-view is: browsers (and, per Tauri's own
// mobile story, iOS/Android app sandboxes) have no OS process-spawning
// model to hook into — this is a hard platform limit, not a missing
// feature. std::process::Child (not the shell plugin) so arbitrary
// developer commands ("npm install", "npm run dev", "cargo build", ...)
// aren't constrained by the shell plugin's static per-command allowlist
// scope, which real dependency-install/dev-server workflows would blow
// through immediately.
#[cfg(desktop)]
use std::collections::HashMap;
#[cfg(desktop)]
use std::io::{BufRead, BufReader};
#[cfg(desktop)]
use std::process::{Child, Stdio};
#[cfg(desktop)]
use std::sync::Mutex;

// --- Desktop-only surfaces (system tray, poppable Quick Capture widget,
// native child-webview Browser room) -----------------------------------
//
// None of these concepts exist on mobile: there's no tray, no floating
// multi-window desktop, and Tauri's `Window::add_child` child-webview
// overlay (what the Browser room uses instead of an <iframe>, see
// open_browser_view below) is a desktop-only API — none of these types
// even expose these methods when compiled for `target_os = "android"`.
// Android build failures here aren't a CI/toolchain problem, they're this:
// the desktop-shell functionality doesn't have a mobile equivalent yet.
//
// Every #[tauri::command] below stays registered on every platform (so the
// frontend's invoke_handler list — and any un-gated `invoke()` call it
// makes — doesn't need to know at compile time which platform it's on),
// but on mobile each one's body is the #[cfg(mobile)] arm: a clean
// Err("... not available on mobile") instead of either a hard compile
// failure or a confusing native panic on a call to something that isn't a
// device concept over there.

/// Poppable Quick Capture widget — a real, independent Tauri window (its
/// own webview, own event loop entry via widget.html/widget-main.tsx), not
/// a modal or a resized main window. Shares the app's localStorage/origin
/// with the main window, so the Supabase session it reads on load is the
/// same signed-in session — no separate auth flow needed. Idempotent:
/// focuses the existing widget window instead of spawning a second one.
#[cfg(desktop)]
fn open_or_focus_capture_widget(app: &tauri::AppHandle) {
  if let Some(w) = app.get_webview_window("capture-widget") {
    let _ = w.show();
    let _ = w.set_focus();
    return;
  }
  let _ = WebviewWindowBuilder::new(app, "capture-widget", WebviewUrl::App("widget.html".into()))
    .title("xOS // Quick Capture")
    .inner_size(360.0, 220.0)
    .min_inner_size(320.0, 180.0)
    .resizable(true)
    .always_on_top(true)
    .decorations(true)
    .skip_taskbar(false)
    .build();
}

/// Frontend calls this (via `invoke`) whenever xAI autonomy/shell settings
/// change, so the tray icon's tooltip reflects real app state instead of a
/// static label — small thing, but it's the difference between a tray icon
/// that's just a launcher and one that's actually a status surface.
#[tauri::command]
fn set_tray_tooltip(#[allow(unused_variables)] app: tauri::AppHandle, #[allow(unused_variables)] text: String) -> Result<(), String> {
  #[cfg(desktop)]
  {
    if let Some(tray) = app.tray_by_id("main-tray") {
      tray.set_tooltip(Some(text.as_str())).map_err(|e| e.to_string())?;
    }
    Ok(())
  }
  #[cfg(mobile)]
  {
    Ok(()) // no system tray on mobile — silently a no-op rather than an error,
           // since this fires on routine state changes, not a deliberate action.
  }
}

/// Frontend-triggered pop-out (a "POP OUT" button in the Capture room, in
/// addition to the tray menu item) — same underlying window logic either
/// way.
#[tauri::command]
fn open_capture_widget(#[allow(unused_variables)] app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(desktop)]
  {
    open_or_focus_capture_widget(&app);
    Ok(())
  }
  #[cfg(mobile)]
  {
    Err("Quick Capture pop-out isn't available on mobile yet — use the Capture room directly.".into())
  }
}

/// Room A (Web Browser): the room's viewport is a real native child webview
/// (`Window::add_child`, requires the "unstable" tauri feature — see
/// Cargo.toml), not an `<iframe>`. Most real sites send
/// X-Frame-Options/CSP frame-ancestors headers that block same-page iframe
/// embedding (banks, social media, most news) — that's a hard browser
/// security rule with no frontend workaround. A genuine embedded webview
/// navigating directly to the URL is a top-level load from that page's own
/// perspective, so it isn't subject to that restriction at all.
///
/// Deliberately absent from capabilities/default.json: this label loads
/// arbitrary untrusted remote sites, so it gets zero Tauri IPC permissions
/// by default — even if a malicious page's own script went looking for
/// window.__TAURI__, the capability ACL has no entry for "browser-view" and
/// denies every command outright.
///
/// Desktop-only, like the rest of this section: `Window::add_child` (the
/// native-child-webview trick this all relies on) isn't available on
/// mobile targets.
#[cfg(desktop)]
const BROWSER_VIEW_LABEL: &str = "browser-view";

/// Shared by the desktop browser-view commands below AND by
/// fetch_page_snapshot (a plain server-side HTTP GET, no webview
/// involved) — so this one stays available on every platform rather than
/// being folded into the desktop-only block.
fn parse_target_url(raw: &str) -> Result<Url, String> {
  Url::parse(raw).map_err(|e| format!("invalid URL: {e}"))
}

const BROWSER_VIEW_MOBILE_ERR: &str =
  "The Browser room's native embedded view isn't available on mobile yet — Tauri's child-webview overlay is desktop-only.";

/// Opens the browser-view child webview if it doesn't exist yet (positioned
/// over the Browser room's viewport, bounds supplied by the frontend via a
/// ResizeObserver), or navigates + repositions the existing one — the room
/// stays mounted across navigation (see RoomOutlet.tsx), so this is
/// idempotent rather than always constructing a fresh webview.
/// Real Chrome-like back/forward (bug fix): the frontend's history stack
/// (Browser room, index.tsx) only ever knew about navigations IT initiated
/// (address bar, its own back/forward buttons) — a link clicked *inside* the
/// loaded page navigated the native child webview directly, with no way for
/// the frontend to find out, so the in-app back button couldn't undo it (it
/// looked disabled, or jumped to the wrong entry). `on_navigation` fires for
/// every navigation this webview makes, ours AND link-clicked ones alike, so
/// emitting it here lets the frontend's history stack track organic in-page
/// navigation exactly like a real browser's does — this is the actual fix,
/// registered once when the child webview is first built (it stays attached
/// for the webview's whole lifetime, so later `.navigate()` calls below
/// still fire it too).
#[cfg(desktop)]
fn browser_nav_handler(app: &tauri::AppHandle) -> impl Fn(&Url) -> bool + Send + 'static {
  let app = app.clone();
  move |url: &Url| {
    let _ = app.emit("browser-nav", url.to_string());
    true // never block a navigation — this hook is for observing, not gating
  }
}

#[tauri::command]
fn open_browser_view(
  #[allow(unused_variables)] app: tauri::AppHandle,
  #[allow(unused_variables)] url: String,
  #[allow(unused_variables)] x: f64,
  #[allow(unused_variables)] y: f64,
  #[allow(unused_variables)] width: f64,
  #[allow(unused_variables)] height: f64,
) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let parsed = parse_target_url(&url)?;
    if let Some(webview) = app.get_webview(BROWSER_VIEW_LABEL) {
      webview.navigate(parsed).map_err(|e| e.to_string())?;
      webview.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
      webview.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
      webview.show().map_err(|e| e.to_string())?;
      return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("main window not found")?;
    let main_as_webview: &Webview<Wry> = main.as_ref();
    let window = main_as_webview.window();
    window
      .add_child(
        WebviewBuilder::new(BROWSER_VIEW_LABEL, WebviewUrl::External(parsed)).on_navigation(browser_nav_handler(&app)),
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
      )
      .map_err(|e| e.to_string())?;
    Ok(())
  }
  #[cfg(mobile)]
  {
    Err(BROWSER_VIEW_MOBILE_ERR.into())
  }
}

#[tauri::command]
fn navigate_browser_view(#[allow(unused_variables)] app: tauri::AppHandle, #[allow(unused_variables)] url: String) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let parsed = parse_target_url(&url)?;
    let webview = app.get_webview(BROWSER_VIEW_LABEL).ok_or("browser view not open")?;
    webview.navigate(parsed).map_err(|e| e.to_string())
  }
  #[cfg(mobile)]
  {
    Err(BROWSER_VIEW_MOBILE_ERR.into())
  }
}

#[tauri::command]
fn set_browser_view_bounds(
  #[allow(unused_variables)] app: tauri::AppHandle,
  #[allow(unused_variables)] x: f64,
  #[allow(unused_variables)] y: f64,
  #[allow(unused_variables)] width: f64,
  #[allow(unused_variables)] height: f64,
) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let webview = app.get_webview(BROWSER_VIEW_LABEL).ok_or("browser view not open")?;
    webview.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    webview.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
  }
  #[cfg(mobile)]
  {
    Err(BROWSER_VIEW_MOBILE_ERR.into())
  }
}

/// Leaving the Browser room: shrink the child webview to zero instead of
/// destroying it, so coming back doesn't lose the loaded page or its
/// in-page history — mirrors how every other room in xOS stays mounted
/// across navigation rather than unmounting (RoomOutlet.tsx).
#[tauri::command]
fn hide_browser_view(#[allow(unused_variables)] app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(desktop)]
  {
    if let Some(webview) = app.get_webview(BROWSER_VIEW_LABEL) {
      webview.set_size(LogicalSize::new(0.0, 0.0)).map_err(|e| e.to_string())?;
    }
    Ok(())
  }
  #[cfg(mobile)]
  {
    Ok(()) // no view to hide on mobile — a no-op, not an error, since this
            // fires on routine room-navigation, not a deliberate action.
  }
}

#[tauri::command]
fn close_browser_view(#[allow(unused_variables)] app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(desktop)]
  {
    if let Some(webview) = app.get_webview(BROWSER_VIEW_LABEL) {
      webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
  }
  #[cfg(mobile)]
  {
    Ok(()) // same reasoning as hide_browser_view above.
  }
}

/// Knowledge Matrix "ADD TO MATRIX": a plain server-side HTTP GET of the
/// current URL (not screen-scraped out of the live browser-view webview —
/// see the module doc comment above on why that IPC bridge stays sealed off
/// from remote content) to pull `<title>`/meta description/visible text for
/// an offline-readable snapshot. Dumb and fast by design per the brief:
/// no AI summarization, just what the page's own HTML already says about
/// itself.
#[derive(serde::Serialize)]
struct PageSnapshot {
  url: String,
  title: String,
  description: String,
  text_content: String,
}

#[tauri::command]
async fn fetch_page_snapshot(url: String) -> Result<PageSnapshot, String> {
  let parsed = parse_target_url(&url)?;
  let client = reqwest::Client::builder()
    .user_agent("xOS-neXus/0.1 (+Knowledge Matrix snapshot fetcher)")
    .timeout(std::time::Duration::from_secs(15))
    .build()
    .map_err(|e| e.to_string())?;
  let resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("fetch failed: HTTP {}", resp.status()));
  }
  let html = resp.text().await.map_err(|e| e.to_string())?;
  let document = scraper::Html::parse_document(&html);

  let title_sel = scraper::Selector::parse("title").unwrap();
  let title = document
    .select(&title_sel)
    .next()
    .map(|el| el.text().collect::<String>().trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| url.clone());

  let desc_sel = scraper::Selector::parse(r#"meta[name="description"]"#).unwrap();
  let og_desc_sel = scraper::Selector::parse(r#"meta[property="og:description"]"#).unwrap();
  let description = document
    .select(&desc_sel)
    .next()
    .or_else(|| document.select(&og_desc_sel).next())
    .and_then(|el| el.value().attr("content"))
    .unwrap_or("")
    .trim()
    .to_string();

  let body_sel = scraper::Selector::parse("body").unwrap();
  let raw_text: String = document
    .select(&body_sel)
    .next()
    .map(|el| el.text().collect::<Vec<_>>().join(" "))
    .unwrap_or_default();
  // Collapse whitespace and cap length — an offline reference excerpt, not
  // a full-page mirror (that's what the source URL is still for, when the
  // Captain is online).
  let collapsed = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");
  let text_content: String = collapsed.chars().take(8000).collect();

  Ok(PageSnapshot { url, title, description, text_content })
}

// ---------------------------------------------------------------------------
// Terminal room (Part 2): real OS shell execution.
//
// This is a genuine child process spawned via std::process::Command — the
// SAME primitive a real terminal emulator uses — not a hardcoded command
// allowlist or a WASM sandbox (unlike the other five Terminal runtimes,
// which are real-but-sandboxed language runtimes; see the module doc
// comment in modules/terminal/index.tsx). It runs `npm install`,
// `npm run dev`, `cargo build`, or anything else the Captain types, with
// the Captain's own OS-level permissions — desktop-only, since that's a
// hard platform limit (browsers cannot spawn OS processes at all; there is
// no frontend-only workaround for this, on this app or any other web app).
//
// Two shapes:
//   - shell_run_sync: runs one command to completion and returns its full
//     stdout/stderr/exit code. Backs the Terminal room's "SHELL" runtime
//     REPL — same one-line-in, one-result-out shape as its Go/PHP REPLs
//     (a fresh process per line; no persistent shell session/env across
//     lines — same honestly-documented limitation those two already have).
//   - shell_spawn_bg / shell_kill_bg: starts a long-running background
//     process (e.g. `npm run dev`) whose stdout/stderr streams to the
//     frontend line-by-line via the "shell-output" Tauri event as it runs,
//     and a "shell-exit" event when it terminates. Backs the "RUN DEV
//     SERVER" button. ShellState tracks live children by pid so
//     shell_kill_bg can actually stop one.
// ---------------------------------------------------------------------------

#[cfg(desktop)]
struct ShellState(Mutex<HashMap<u32, Child>>);

#[derive(serde::Serialize)]
struct ShellResult {
  stdout: String,
  stderr: String,
  code: Option<i32>,
}

#[cfg(desktop)]
fn build_shell_command(cmd: &str, cwd: &Option<String>) -> std::process::Command {
  let mut c = if cfg!(target_os = "windows") {
    let mut c = std::process::Command::new("cmd");
    c.arg("/C").arg(cmd);
    c
  } else {
    let mut c = std::process::Command::new("sh");
    c.arg("-c").arg(cmd);
    c
  };
  if let Some(dir) = cwd {
    if !dir.trim().is_empty() {
      c.current_dir(dir);
    }
  }
  c
}

#[tauri::command]
async fn shell_run_sync(
  #[allow(unused_variables)] cmd: String,
  #[allow(unused_variables)] cwd: Option<String>,
) -> Result<ShellResult, String> {
  #[cfg(desktop)]
  {
    // Runs on a blocking-pool thread (a real, possibly slow child process —
    // `npm install` can take tens of seconds) rather than the async
    // runtime's own worker threads, same reasoning `spawn_blocking` exists
    // for generally: a genuinely blocking wait shouldn't tie up threads
    // other in-flight `invoke` calls need.
    tauri::async_runtime::spawn_blocking(move || {
      let output = build_shell_command(&cmd, &cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
      Ok(ShellResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code(),
      })
    })
    .await
    .map_err(|e| e.to_string())?
  }
  #[cfg(mobile)]
  {
    Err("Real shell execution isn't available on mobile — no OS child-process model to spawn into (a hard platform limit, not a missing feature).".into())
  }
}

#[derive(serde::Serialize, Clone)]
struct ShellOutputEvent {
  pid: u32,
  stream: String,
  line: String,
}
#[derive(serde::Serialize, Clone)]
struct ShellExitEvent {
  pid: u32,
  code: Option<i32>,
}

#[tauri::command]
fn shell_spawn_bg(
  #[allow(unused_variables)] app: tauri::AppHandle,
  #[allow(unused_variables)] cmd: String,
  #[allow(unused_variables)] cwd: Option<String>,
) -> Result<u32, String> {
  #[cfg(desktop)]
  {
    let mut child = build_shell_command(&cmd, &cwd)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
      let state = app.state::<ShellState>();
      let mut map = state.0.lock().map_err(|_| "shell state lock poisoned".to_string())?;
      map.insert(pid, child);
    }

    if let Some(out) = stdout {
      let app_out = app.clone();
      std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
          let _ = app_out.emit("shell-output", ShellOutputEvent { pid, stream: "stdout".into(), line });
        }
      });
    }
    if let Some(err) = stderr {
      let app_err = app.clone();
      std::thread::spawn(move || {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
          let _ = app_err.emit("shell-output", ShellOutputEvent { pid, stream: "stderr".into(), line });
        }
      });
    }

    // Polls for the child's exit rather than a blocking `.wait()` — the
    // Child stays owned by ShellState's map the whole time (so
    // shell_kill_bg can still reach it to kill it early), so this thread
    // borrows it through the same Mutex on each poll instead of taking
    // ownership outright.
    let app_wait = app.clone();
    std::thread::spawn(move || loop {
      std::thread::sleep(std::time::Duration::from_millis(300));
      let state = app_wait.state::<ShellState>();
      let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => break,
      };
      let exited: Option<Option<i32>> = match map.get_mut(&pid) {
        Some(child) => match child.try_wait() {
          Ok(Some(status)) => Some(status.code()),
          Ok(None) => None,
          Err(_) => Some(None),
        },
        None => break, // already removed (killed via shell_kill_bg)
      };
      if let Some(code) = exited {
        map.remove(&pid);
        drop(map);
        let _ = app_wait.emit("shell-exit", ShellExitEvent { pid, code });
        break;
      }
    });

    Ok(pid)
  }
  #[cfg(mobile)]
  {
    Err("Real shell execution isn't available on mobile — no OS child-process model to spawn into (a hard platform limit, not a missing feature).".into())
  }
}

#[tauri::command]
fn shell_kill_bg(#[allow(unused_variables)] app: tauri::AppHandle, #[allow(unused_variables)] pid: u32) -> Result<(), String> {
  #[cfg(desktop)]
  {
    let state = app.state::<ShellState>();
    let mut map = state.0.lock().map_err(|_| "shell state lock poisoned".to_string())?;
    if let Some(mut child) = map.remove(&pid) {
      child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
  }
  #[cfg(mobile)]
  {
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    // Step 8: local SQLite mirror for offline-first capture (see
    // src/lib/localDb.ts + src/lib/offlineSync.ts on the frontend side).
    .plugin(tauri_plugin_sql::Builder::default().build())
    // Terminal (.py) / Browser (.html) file editing: native open/save
    // dialogs (plugin-dialog) and reading/writing the chosen path
    // (plugin-fs) — see src/design-system's CodeEditor and the Terminal/
    // Browser room modules on the frontend side.
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // Browser room "open externally" fallback + Terminal room's "open my
    // dev server in the system browser" — see src/lib/opener.ts on the
    // frontend side. Cross-platform (desktop + mobile both have a default-
    // app-handler concept), unlike the shell/browser-view state below.
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      set_tray_tooltip,
      open_capture_widget,
      open_browser_view,
      navigate_browser_view,
      set_browser_view_bounds,
      hide_browser_view,
      close_browser_view,
      fetch_page_snapshot,
      shell_run_sync,
      shell_spawn_bg,
      shell_kill_bg
    ]);
  // ShellState (live background-process tracking for shell_spawn_bg /
  // shell_kill_bg) only has meaning where OS processes can actually be
  // spawned — see the #[cfg(desktop)] commands above.
  #[cfg(desktop)]
  let builder = builder.manage(ShellState(Mutex::new(HashMap::new())));
  builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // System tray + "closing hides to tray instead of quitting" are both
      // desktop-only concepts — no tray, no background-process convention
      // to hide into on mobile (the OS owns app lifecycle there instead).
      #[cfg(desktop)]
      {
        // System tray — real menu (Show, Quick Capture, Quit), left-click
        // shows/focuses the main window (the common tray-icon convention),
        // right-click (or left-click on platforms without a separate
        // right-click gesture) opens the menu.
        let show_i = MenuItem::with_id(app, "show", "Show xOS", true, None::<&str>)?;
        let capture_i = MenuItem::with_id(app, "capture", "Quick Capture", true, None::<&str>)?;
        let quit_i = MenuItem::with_id(app, "quit", "Quit xOS", true, None::<&str>)?;
        let menu = Menu::with_items(
          app,
          &[&show_i, &capture_i, &PredefinedMenuItem::separator(app)?, &quit_i],
        )?;

        let _tray = TrayIconBuilder::with_id("main-tray")
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&menu)
          .show_menu_on_left_click(true)
          .tooltip("xOS: neXus")
          .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
            "capture" => open_or_focus_capture_widget(app),
            "quit" => app.exit(0),
            _ => {}
          })
          .build(app)?;

        // Closing the main window hides it to the tray instead of quitting —
        // the standard system-tray convention, and the whole reason a tray
        // icon is useful rather than decorative. The widget window keeps its
        // own default close behavior (destroys itself), since it's meant to
        // be a disposable pop-out, not a persistent background surface.
        if let Some(main) = app.get_webview_window("main") {
          let main_handle = main.clone();
          main.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
              api.prevent_close();
              let _ = main_handle.hide();
            }
          });
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
