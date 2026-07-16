use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
  Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Step 8: local SQLite mirror for offline-first capture (see
    // src/lib/localDb.ts + src/lib/offlineSync.ts on the frontend side).
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![set_tray_tooltip, open_capture_widget])
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
