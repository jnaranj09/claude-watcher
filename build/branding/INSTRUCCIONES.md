# Íconos de la app — instrucciones de integración (Fedora KDE / Plasma)

Este bundle contiene el set de íconos de la aplicación: una estrella de Claude con casco de obrero amarillo. Hay tres variantes de diseño, cada una optimizada para un contexto de uso distinto. **No uses el ícono grande para el tray ni el del tray para el launcher** — están diseñados para distintos tamaños de render.

## Manifiesto de archivos

| Archivo | Uso | Notas |
|---|---|---|
| `icons/claude-obrero.svg` | Ícono principal de la app (launcher, taskbar, ventana) | Versión detallada, escala bien de 48px hacia arriba |
| `icons/claude-obrero-512.png` | Fallback raster del ícono principal | Para manifests que exigen PNG (Flatpak, AppImage, packaging) |
| `icons/claude-obrero-tray.svg` | System tray, versión a color | Diseño simplificado: 8 rayos gruesos, casco sin detalles finos. Legible a 22px |
| `icons/claude-obrero-tray-22.png` | Tray a color, raster 22px | Tamaño estándar del system tray de Plasma |
| `icons/claude-obrero-tray-16.png` | Tray a color, raster 16px | Para paneles pequeños |
| `icons/claude-obrero-tray-symbolic.svg` | System tray, versión monocromática (recomendada) | Sigue la convención de recoloreo de KDE — ver sección abajo |

## Paso 1 — Renombrar según el nombre de la app

Reemplazá `claude-obrero` por el nombre real de la app (ejemplo: `miapp`). El nombre del archivo de ícono (sin extensión) es lo que se referencia en el `.desktop` y en el tray. Mantené el sufijo `-symbolic` en la variante monocromática — es convención freedesktop.

## Paso 2 — Instalar en el icon theme (hicolor)

Instalación por usuario:

```bash
install -Dm644 icons/claude-obrero.svg          ~/.local/share/icons/hicolor/scalable/apps/miapp.svg
install -Dm644 icons/claude-obrero-tray-22.png  ~/.local/share/icons/hicolor/22x22/apps/miapp-tray.png
install -Dm644 icons/claude-obrero-tray-16.png  ~/.local/share/icons/hicolor/16x16/apps/miapp-tray.png
install -Dm644 icons/claude-obrero-tray-symbolic.svg ~/.local/share/icons/hicolor/scalable/apps/miapp-tray-symbolic.svg
gtk-update-icon-cache -f ~/.local/share/icons/hicolor 2>/dev/null || true
```

Para instalación a nivel sistema (paquete RPM, etc.) usá `/usr/share/icons/hicolor/...` con las mismas rutas relativas.

## Paso 3 — Archivo .desktop

En el `.desktop` de la app, referenciá el ícono por nombre, **sin ruta y sin extensión**:

```ini
[Desktop Entry]
Type=Application
Name=MiApp
Exec=miapp
Icon=miapp
Categories=Utility;
```

## Paso 4 — System tray

Si la app usa StatusNotifierItem (Qt: `QSystemTrayIcon` o KStatusNotifierItem; Electron: `Tray`), pasá el **nombre** del ícono y dejá que el theme lo resuelva por tamaño:

- Opción recomendada (se integra con Breeze): `miapp-tray-symbolic`
- Opción a color: `miapp-tray`

En Qt: `QIcon::fromTheme("miapp-tray-symbolic")`. Si el framework solo acepta rutas de archivo (algunos casos en Electron), usá el PNG de 22px directamente.

### Cómo funciona la variante symbolic

El SVG monocromático incluye el bloque que Plasma usa para recolorear íconos según el esquema de color del panel:

```xml
<style type="text/css" id="current-color-scheme">
  .ColorScheme-Text { color:#232629; }
</style>
```

Los elementos usan `fill="currentColor"` con `class="ColorScheme-Text"`. Cuando Plasma carga el ícono vía KIconLoader, reemplaza ese color por el color de texto del tema activo: se ve oscuro en panel claro y claro en panel oscuro, automáticamente. **No conviertas este SVG a PNG** — el raster pierde la capacidad de recoloreo. Tampoco cambies el `id` del `<style>` ni las clases.

## Regenerar tamaños adicionales

Si algún empaquetado pide tamaños que no están en el bundle (32, 48, 64, 128, 256), generalos desde el SVG correspondiente. En Fedora:

```bash
sudo dnf install librsvg2-tools   # si no está rsvg-convert
rsvg-convert -w 128 -h 128 icons/claude-obrero.svg -o miapp-128.png
```

Regla: tamaños ≥ 48px se generan desde `claude-obrero.svg`; tamaños ≤ 32px desde `claude-obrero-tray.svg` (el diseño simplificado, si no, los detalles se vuelven ruido).

## Verificación

Después de instalar: `kstart5 plasmashell --replace` no es necesario — basta con relogin o `kbuildsycoca6` (Plasma 6) / `kbuildsycoca5` (Plasma 5) para refrescar el caché de .desktop. Para verificar que el theme resuelve el ícono: `qtpaths --locate-files GenericDataLocation icons/hicolor/scalable/apps/miapp.svg` o simplemente buscar la app en el launcher (Kickoff).
