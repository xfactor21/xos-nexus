use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
  LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl, WebviewWindowBuilder,
  WindowEvent, Wry,
};

/// Poppable Quick Capture widget — a real, independent Tauri window (its
/// own webview, own event loop entry via widget.html/widget-main.tsx), not
/// a modal or a resized main window. Shares the app's localStorage/origin
/// with the main window, so the Supabase session it reads on load is the
/// same signed-in session — no separate auth flow needed. Idempotent:
/// focuses the existing widget window instead of spawning a second one.
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
fn set_tray_tooltip(app: tauri::AppHandle, text: String) -> Result<(), String> {
  if let Some(tray) = app.tray_by_id("main-tray") {
    tray.set_tooltip(Some(text.as_str())).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Frontend-triggered pop-out (a "POP OUT" button in the Capture room, in
/// addition to the tray menu item) — same underlying window logic either
/// way.
#[tauri::command]
fn open_capture_widget(app: tauri::AppHandle) -> Result<(), String> {
  open_or_focus_capture_widget(&app);
  Ok(())
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
const BROWSER_VIEW_LABEL: &str = "browser-view";

fn parse_target_url(raw: &str) -> Result<Url, String> {
  Url::parse(raw).map_err(|e| format!("invalid URL: {e}"))
}

/// Opens the browser-view child webview if it doesn't exist yet (positioned
/// over the Browser room's viewport, bounds supplied by the frontend via a
/// ResizeObserver), or navigates + repositions the existing one — the room
/// stays mounted across navigation (see RoomOutlet.tsx), so this is
/// idempotent rather than always constructing a fresh webview.
#[tauri::command]
fn open_browser_view(app: tauri::AppHandle, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
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
      WebviewBuilder::new(BROWSER_VIEW_LABEL, WebviewUrl::External(parsed)),
      LogicalPosition::new(x, y),
      LogicalSize::new(width, height),
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn navigate_browser_view(app: tauri::AppHandle, url: String) -> Result<(), String> {
  let parsed = parse_target_url(&url)?;
  let webview = app.get_webview(BROWSER_VIEW_LABEL).ok_or("browser view not open")?;
  webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_browser_view_bounds(app: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  let webview = app.get_webview(BROWSER_VIEW_LABEL).ok_or("browser view not open")?;
  webview.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
  webview.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

/// Leaving the Browser room: shrink the child webview to zero instead of
/// destroying it, so coming back doesn't lose the loaded page or its
/// in-page history — mirrors how every other room in xOS stays mounted
/// across navigation rather than unmounting (RoomOutlet.tsx).
#[tauri::command]
fn hide_browser_view(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(webview) = app.get_webview(BROWSER_VIEW_LABEL) {
    webview.set_size(LogicalSize::new(0.0, 0.0)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn close_browser_view(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(webview) = app.get_webview(BROWSER_VIEW_LABEL) {
    webview.close().map_err(|e| e.to_string())?;
  }
  Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Step 8: local SQLite mirror for offline-first capture (see
    // src/lib/localDb.ts + src/lib/offlineSync.ts on the frontend side).
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      set_tray_tooltip,
      open_capture_widget,
      open_browser_view,
      navigate_browser_view,
      set_browser_view_bounds,
      hide_browser_view,
      close_browser_view,
      fetch_page_snapshot
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

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

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
