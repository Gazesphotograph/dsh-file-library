window.__ModuleLoader__.load({
	id: "@local/dsh-file-library",
	factory(require) {
		const React = require("react")
		const h = React.createElement
		const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React

		/** Dictionary namespace owned by this plugin. */
		const NS = "fileLibrary"
		/** The id shared by the sidebar entry and the main panel it opens. */
		const PANEL_ID = "file-library"
		/** Match the shipped RPC client's document-relative URL, including a proxy mount. */
		const API = "api/dsh-file-library"

		// ---------------------------------------------------------------------
		// Styles: only --dsw-alias-* tokens, prefixed classes.
		// ---------------------------------------------------------------------
		const CSS = `
.flb-root{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.flb-head{display:flex;align-items:flex-start;gap:12px;padding:20px 24px 12px;flex:none}
.flb-headText{min-width:0;flex:1}
.flb-title{margin:0;font-size:18px;font-weight:600;line-height:26px}
.flb-subtitle{margin:2px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.flb-actions{display:flex;align-items:center;gap:8px;flex:none}
.flb-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.flb-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.flb-btn:disabled{opacity:.55;cursor:default}
.flb-btnPrimary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.flb-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill);opacity:.88}
.flb-btnGhost{border-color:transparent;background:transparent}
.flb-btnIcon{width:32px;padding:0;justify-content:center}
.flb-searchRow{display:flex;align-items:center;gap:8px;padding:0 24px 10px;flex:none}
.flb-search{flex:1;display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.flb-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:13px}
.flb-tabs{display:flex;align-items:center;gap:4px;padding:0 24px 8px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}
.flb-tab{height:30px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.flb-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.flb-tab[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.flb-body{position:relative;flex:1;min-height:0;min-width:0;display:flex}
.flb-list{flex:1;min-width:0;overflow:auto;padding:8px 12px 24px}
.flb-row{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border-radius:var(--dsw-radius-md);border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.flb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.flb-row[aria-current=true]{background:var(--dsw-alias-interactive-bg-active)}
.flb-thumb{width:40px;height:40px;border-radius:var(--dsw-radius-sm);flex:none;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);overflow:hidden}
.flb-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.flb-rowText{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.flb-name{font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flb-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flb-badge{flex:none;font-size:11px;line-height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.flb-badgeMod{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-primary)}
.flb-badgeSame{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-label-primary)}
.flb-star{flex:none;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center}
.flb-star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.flb-star[data-on=true]{color:var(--dsw-alias-state-warn-label)}
.flb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:64px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.flb-emptyTitle{font-size:14px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.flb-error,.flb-error .flb-emptyTitle{color:var(--dsw-alias-state-error-primary)}
.flb-detail{box-sizing:border-box;width:min(360px,48%);flex:none;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:16px;background:var(--dsw-alias-bg-base)}
.flb-detailHead{display:flex;align-items:flex-start;gap:8px;margin-bottom:12px}
.flb-detailTitle{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:22px;word-break:break-all}
.flb-section{margin-top:14px}
.flb-sectionLabel{font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.flb-path{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:18px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:6px 8px;word-break:break-all}
.flb-copy{margin-left:auto;flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:11px;padding:0 2px}
.flb-copy:hover{color:var(--dsw-alias-label-primary)}
.flb-kv{display:flex;gap:8px;font-size:12px;line-height:20px}
.flb-kvKey{color:var(--dsw-alias-label-tertiary);width:72px;flex:none}
.flb-kvVal{color:var(--dsw-alias-label-secondary);min-width:0;word-break:break-word}
.flb-preview{width:100%;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);display:block;background:var(--dsw-alias-bg-layer-1)}
.flb-drop{position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:100;display:flex;flex-direction:column;max-height:min(420px,60vh);border-radius:var(--dsw-radius-lg);background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--dsw-specific-menu,transparent),var(--dsw-specific-menu,transparent));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);box-sizing:border-box;border:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
.flb-notice{position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:99;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--dsw-radius-md);background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--dsw-specific-menu,transparent),var(--dsw-specific-menu,transparent));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-soft);border:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.flb-drop .flb-empty{padding:28px 16px}
.flb-modalHead{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.flb-modalTitle{flex:1;font-size:14px;font-weight:600}
.flb-modalBody{flex:1;min-height:0;overflow:auto;padding:8px 8px 12px}
.flb-modalFoot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1);flex:none}
.flb-pick{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:var(--dsw-radius-md);border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.flb-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}
.flb-pick[data-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.flb-check{width:16px;height:16px;flex:none;border-radius:4px;border:1px solid var(--dsw-alias-border-l3);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary-inverted)}
.flb-check[data-on=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent}
.flb-spin{animation:flb-spin 1s linear infinite}
.flb-root button:focus-visible,.flb-drop button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
@media(max-width:680px){.flb-head{flex-wrap:wrap;padding:14px 12px 10px}.flb-actions{flex-wrap:wrap}.flb-searchRow{padding-left:12px;padding-right:12px}.flb-tabs{padding-left:12px;padding-right:12px}.flb-list{padding-left:4px;padding-right:4px}.flb-row{gap:8px;padding-left:8px;padding-right:8px}.flb-row>.flb-badge{display:none}.flb-detail{position:absolute;inset:0;width:100%;z-index:1;border-left:0}.flb-modalFoot{gap:6px;padding:10px}.flb-modalFoot .flb-btn{padding:0 8px}.flb-modalFoot>.flb-sub{min-width:0;white-space:normal}.flb-drop{max-height:min(420px,60dvh)}}
@media(prefers-reduced-motion:reduce){.flb-spin{animation:none}}
@keyframes flb-spin{to{transform:rotate(360deg)}}
`

		/**
		 * Insert this plugin's stylesheet once, at plugin load.
		 *
		 * This MUST run from `apply`, not from a component: the composer picker is a
		 * separate overlay entry that can mount while the library page never has.
		 * When the sheet was installed from the page component instead, opening the
		 * picker from the composer rendered it with no CSS at all — an unstyled
		 * full-screen block that covered the whole application.
		 *
		 * @returns disposer removing the style element.
		 */
		function installStyles() {
			const tagId = "@local/dsh-file-library/style.css"
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {}
			const tag = document.createElement("style")
			tag.dataset.plugin = "@local/dsh-file-library"
			tag.dataset.pluginCss = tagId
			tag.textContent = CSS
			document.head.appendChild(tag)
			return () => {
				tag.remove()
			}
		}

		// ---------------------------------------------------------------------
		// Small inline icons (no Harness client package imports allowed).
		// ---------------------------------------------------------------------
		function Icon({ size = 16, children, ...rest }) {
			return h("svg", {
				viewBox: "0 0 24 24", width: size, height: size, fill: "none",
				"aria-hidden": "true", ...rest,
			}, children)
		}
		const FolderIcon = (p) => h(Icon, p,
			h("path", { d: "M3.5 7.2c0-1.1.9-2 2-2h3.1c.5 0 1 .2 1.4.6l1.1 1.1c.4.4.9.6 1.4.6h5.9c1.1 0 2 .9 2 2v7.3c0 1.1-.9 2-2 2H5.5c-1.1 0-2-.9-2-2V7.2Z", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" }),
			h("path", { d: "M8.2 13.6h7.6M8.2 16.4h4.9", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }))
		const ImageIcon = (p) => h(Icon, p,
			h("rect", { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, stroke: "currentColor", strokeWidth: 1.6 }),
			h("circle", { cx: 9, cy: 10, r: 1.6, fill: "currentColor" }),
			h("path", { d: "m5 17 4.2-4.2a1.6 1.6 0 0 1 2.2 0L20 20", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }))
		const FileIcon = (p) => h(Icon, p,
			h("path", { d: "M6 3.5h7.2L19 9.3v11.2H6V3.5Z", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" }),
			h("path", { d: "M13 3.7V9.5h5.8", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" }))
		const UploadIcon = (p) => h(Icon, p,
			h("path", { d: "M12 16V4.5m0 0L8 8.5m4-4 4 4", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
			h("path", { d: "M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }))
		const RefreshIcon = (p) => h(Icon, p,
			h("path", { d: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }),
			h("path", { d: "M19.8 4.5v4.2h-4.2", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }))
		const SearchIcon = (p) => h(Icon, p,
			h("circle", { cx: 11, cy: 11, r: 6.5, stroke: "currentColor", strokeWidth: 1.6 }),
			h("path", { d: "m16 16 4 4", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }))
		const StarIcon = (p) => h(Icon, p,
			h("path", { d: "m12 4 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8L12 4Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" }))
		const CloseIcon = (p) => h(Icon, p,
			h("path", { d: "m6 6 12 12M18 6 6 18", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }))
		const CheckIcon = (p) => h(Icon, p,
			h("path", { d: "m5 12.5 4.5 4.5L19 7", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }))

		// ---------------------------------------------------------------------
		// Host API client
		// ---------------------------------------------------------------------
		// Connection authenticates browser requests with the HttpOnly cookie minted
		// by authorizeIndex. Same-origin credentials already send it; no token or
		// Authorization header belongs in this client (including raw image URLs).
		async function api(path, options = {}) {
			const headers = new Headers(options.headers)
			if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
			const response = await fetch(`${API}${path}`, { ...options, credentials: "same-origin", headers })
			let body = null
			try {
				body = await response.json()
			} catch (error) {
				if (options.signal?.aborted) throw error
			}
			if (!response.ok || body?.ok !== true) {
				const message = body?.error?.message ?? body?.message ?? (response.ok ? "Invalid file library response" : `HTTP ${response.status}`)
				const error = new Error(message)
				error.code = body?.error?.code ?? (response.ok ? "INVALID_RESPONSE" : undefined)
				throw error
			}
			return body
		}

		const listItems = (query, signal) => api(`/items${query ? `?query=${encodeURIComponent(query)}` : ""}`, { signal })
		const uploadFile = (name, mediaType, base64, signal) => api("/upload", { method: "POST", body: JSON.stringify({ name, mediaType, dataBase64: base64 }), signal })
		const refreshLibrary = (signal) => api("/refresh", { method: "POST", body: "{}", signal })
		const setFavorite = (id, favorite, signal) => api("/state", { method: "POST", body: JSON.stringify({ id, favorite }), signal })
		const rawUrl = (id) => `${API}/raw?id=${encodeURIComponent(id)}`

		function fileToBase64(file, signal) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader()
				const finish = (callback, value) => {
					signal?.removeEventListener("abort", abort)
					callback(value)
				}
				const abort = () => {
					reader.abort()
					finish(reject, new DOMException("File read cancelled", "AbortError"))
				}
				reader.onload = () => {
					const result = String(reader.result ?? "")
					const comma = result.indexOf(",")
					finish(resolve, comma >= 0 ? result.slice(comma + 1) : result)
				}
				reader.onerror = () => finish(reject, reader.error ?? new Error("read failed"))
				if (signal?.aborted) { abort(); return }
				signal?.addEventListener("abort", abort, { once: true })
				try {
					reader.readAsDataURL(file)
				} catch (error) {
					finish(reject, error)
				}
			})
		}

		function formatBytes(bytes) {
			const value = Number(bytes) || 0
			if (value < 1024) return `${value} B`
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
			if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
			return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
		}

		function formatTime(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "—"
			try {
				return new Date(ms).toLocaleString()
			} catch {
				return "—"
			}
		}

		function baseName(path) {
			const text = String(path ?? "")
			const at = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"))
			return at >= 0 ? text.slice(at + 1) : text
		}

		function shortPath(path, max = 72) {
			const text = String(path ?? "")
			if (text.length <= max) return text
			const head = text.slice(0, Math.floor(max * 0.45))
			const tail = text.slice(-Math.floor(max * 0.45))
			return `${head}…${tail}`
		}

		function matchesQuery(item, query) {
			const text = query.trim().toLowerCase()
			return text === "" || [item.name, item.id, item.sha256, item.readonlyPath, item.mediaType,
				...(item.copies ?? []).map((copy) => copy.path),
				...(item.sessions ?? []).map((usage) => `${usage.title ?? ""} ${usage.cwd ?? ""}`),
			].filter(Boolean).join(" ").toLowerCase().includes(text)
		}

		// ---------------------------------------------------------------------
		// Library data loading, used by both the page and picker.
		// ---------------------------------------------------------------------
		function createLibraryLoader(publish) {
			let active = null
			return {
				async load(query = "", refresh = false) {
					active?.abort()
					const controller = new AbortController()
					active = controller
					publish((current) => ({ ...current, phase: current.items.length === 0 ? "loading" : "refreshing", error: null }))
					try {
						const body = await (refresh ? refreshLibrary(controller.signal) : listItems(query, controller.signal))
						if (active !== controller || controller.signal.aborted) return null
						if (!Array.isArray(body.items)) throw new Error("Invalid file library items")
						publish({ phase: "ready", items: body.items, totals: body.totals ?? null, error: null, generatedAt: body.generatedAt ?? Date.now() })
						return body
					} catch (error) {
						if (active === controller && !controller.signal.aborted) publish((current) => ({ ...current, phase: "error", error }))
						return null
					} finally {
						if (active === controller) active = null
					}
				},
				cancel() {
					active?.abort()
					active = null
				},
			}
		}
		function useLibrary() {
			const [state, setState] = useState({ phase: "loading", items: [], totals: null, error: null, generatedAt: 0 })
			const loader = useRef(null)
			if (loader.current === null) loader.current = createLibraryLoader(setState)
			const load = useCallback((query, refresh) => loader.current.load(query, refresh), [])
			useEffect(() => {
				void load("")
				return () => loader.current.cancel()
			}, [load])
			return { ...state, reload: load, setState }
		}

		// ---------------------------------------------------------------------
		// Path row with copy action
		// ---------------------------------------------------------------------
		function PathRow({ label, path, t, tone }) {
			const [copied, setCopied] = useState(false)
			const lifetime = useRef(null)
			useEffect(() => {
				const current = { active: true, timer: null }
				lifetime.current = current
				setCopied(false)
				return () => {
					current.active = false
					window.clearTimeout(current.timer)
				}
			}, [path])
			if (!path) return null
			const copy = async () => {
				const current = lifetime.current
				try {
					await navigator.clipboard.writeText(path)
					if (!current?.active) return
					setCopied(true)
					window.clearTimeout(current.timer)
					current.timer = window.setTimeout(() => setCopied(false), 1200)
				} catch {
					/* clipboard may be unavailable; the path stays selectable */
				}
			}
			return h("div", { className: "flb-section" },
				h("div", { className: "flb-sectionLabel" }, label),
				h("div", { className: "flb-path", "data-tone": tone ?? "normal" },
					h("span", null, path),
					h("button", { type: "button", className: "flb-copy", onClick: copy, title: t("action.copyPath") },
						copied ? t("copy.done") : t("action.copyPath"))))
		}

		// ---------------------------------------------------------------------
		// Detail panel
		// ---------------------------------------------------------------------
		function DetailPanel({ item, t, onFavorite, onClose }) {
			if (!item) return null
			const isImage = item.kind === "image"
			return h("aside", { className: "flb-detail", "aria-label": t("detail.title") },
				h("div", { className: "flb-detailHead" },
					h("div", { className: "flb-detailTitle" }, item.name || item.id),
					h("button", { type: "button", className: "flb-btn flb-btnGhost flb-btnIcon", onClick: onClose, "aria-label": t("action.close") }, h(CloseIcon, { size: 16 }))),
				isImage && h("img", { className: "flb-preview", src: rawUrl(item.id), alt: item.name || "" }),
				h("div", { className: "flb-section" },
					h("div", { className: "flb-kv" }, h("span", { className: "flb-kvKey" }, t("meta.kind")), h("span", { className: "flb-kvVal" }, item.mediaType || item.kind)),
					h("div", { className: "flb-kv" }, h("span", { className: "flb-kvKey" }, t("meta.size")), h("span", { className: "flb-kvVal" }, formatBytes(item.bytes))),
					item.width && item.height && h("div", { className: "flb-kv" }, h("span", { className: "flb-kvKey" }, t("meta.dimensions")), h("span", { className: "flb-kvVal" }, `${item.width} × ${item.height}`)),
					h("div", { className: "flb-kv" }, h("span", { className: "flb-kvKey" }, t("meta.created")), h("span", { className: "flb-kvVal" }, formatTime(item.createdAt)))),
				h(PathRow, { label: item.readonlyExists === false ? t("path.readonly.missing") : t("path.readonly"), path: item.readonlyPath, t }),
				h("div", { className: "flb-section" },
					h("div", { className: "flb-sectionLabel" }, t("path.workspace")),
					(item.copies ?? []).length === 0
						? h("div", { className: "flb-kv" }, h("span", { className: "flb-kvVal" }, t("path.none")))
						: (item.copies ?? []).map((copy, index) => h("div", { key: `${copy.path}-${index}`, className: "flb-section" },
							h("div", { className: "flb-path" }, h("span", null, copy.path)),
							h("div", { className: "flb-kv" },
								h("span", { className: `flb-badge ${copy.state === "identical" ? "flb-badgeSame" : copy.state === "modified" ? "flb-badgeMod" : ""}` },
									t(copy.state === "identical" ? "path.workspace.identical" : copy.state === "modified" ? "path.workspace.modified" : "path.workspace.unverified")))))),
				(item.sessions ?? []).length > 0 && h("div", { className: "flb-section" },
					h("div", { className: "flb-sectionLabel" }, t("detail.sessions")),
					(item.sessions ?? []).map((usage) => h("div", { key: usage.id, className: "flb-kv" },
						h("span", { className: "flb-kvVal" }, `${usage.title || usage.id} · ${formatTime(usage.at)}`)))),
				h("div", { className: "flb-section" },
					h("button", {
						type: "button", className: "flb-btn",
						onClick: () => onFavorite(item, !item.favorite),
					}, item.favorite ? t("action.unfavorite") : t("action.favorite"))))
		}

		// ---------------------------------------------------------------------
		// Main panel page
		// ---------------------------------------------------------------------
		function FileLibraryPage(props) {
			const t = props.t
			const library = useLibrary()
			const [tab, setTab] = useState("all")
			const [query, setQuery] = useState("")
			const [selectedId, setSelectedId] = useState(null)
			const [busy, setBusy] = useState(null)
			const [notice, setNotice] = useState(null)
			const inputRef = useRef(null)
			const lifetime = useRef(null)
			const operation = useRef(null)
			const noticeTimer = useRef(null)
			const pendingFavorites = useRef(new Set())
			useEffect(() => {
				const controller = new AbortController()
				lifetime.current = controller
				return () => {
					controller.abort()
					window.clearTimeout(noticeTimer.current)
				}
			}, [])
			const showNotice = (text) => {
				if (lifetime.current?.signal.aborted !== false) return
				window.clearTimeout(noticeTimer.current)
				setNotice(text)
				noticeTimer.current = window.setTimeout(() => setNotice(null), 3600)
			}

			const items = library.items
			const filtered = useMemo(() => {
				const text = query.trim().toLowerCase()
				return items.filter((item) => {
					if (tab === "images" && item.kind !== "image") return false
					if (tab === "files" && item.kind === "image") return false
					if (tab === "favorites" && item.favorite !== true) return false
					if (tab === "manual" && item.origin !== "manual") return false
					return matchesQuery(item, text)
				})
			}, [items, tab, query])

			const selected = items.find((item) => item.id === selectedId) ?? null

			const onUpload = async (event) => {
				const files = Array.from(event.target.files ?? [])
				event.target.value = ""
				const signal = lifetime.current?.signal
				if (files.length === 0 || !signal || signal.aborted || operation.current !== null) return
				operation.current = "upload"
				setBusy("upload")
				let completed = 0
				try {
					for (const file of files) {
						const base64 = await fileToBase64(file, signal)
						await uploadFile(file.name, file.type || "", base64, signal)
						completed += 1
					}
					showNotice(t("upload.done"))
				} catch (error) {
					if (!signal.aborted) showNotice(`${t("upload.failed")}: ${error.message}`)
				} finally {
					if (!signal.aborted) {
						// Earlier files in a batch remain uploaded when a later one fails.
						if (completed > 0) await library.reload("")
						if (!signal.aborted) setBusy(null)
					}
					operation.current = null
				}
			}

			const onRefresh = async () => {
				const signal = lifetime.current?.signal
				if (!signal || signal.aborted || operation.current !== null) return
				operation.current = "refresh"
				setBusy("refresh")
				try {
					const body = await library.reload("", true)
					if (body !== null && !signal.aborted) showNotice(t("refresh.done"))
				} finally {
					operation.current = null
					if (!signal.aborted) setBusy(null)
				}
			}

			const onFavorite = async (item, favorite) => {
				const signal = lifetime.current?.signal
				if (!signal || signal.aborted || pendingFavorites.current.has(item.id)) return
				pendingFavorites.current.add(item.id)
				try {
					await setFavorite(item.id, favorite, signal)
					if (signal.aborted) return
					library.setState((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, favorite } : entry) }))
					await library.reload("")
				} catch (error) {
					if (!signal.aborted) showNotice(`${t("error")}: ${error.message}`)
				} finally {
					pendingFavorites.current.delete(item.id)
				}
			}

			const tabs = [
				["all", t("tab.all")], ["images", t("tab.images")], ["files", t("tab.files")],
				["favorites", t("tab.favorites")], ["manual", t("tab.manual")],
			]

			return h("div", { className: "flb-root" },
				h("div", { className: "flb-head" },
					h("div", { className: "flb-headText" },
						h("h1", { className: "flb-title" }, t("title")),
						h("p", { className: "flb-subtitle" }, notice ?? t("subtitle"))),
					h("div", { className: "flb-actions" },
						h("button", { type: "button", className: "flb-btn", onClick: onRefresh, disabled: busy !== null },
							h(RefreshIcon, { size: 16, className: busy === "refresh" ? "flb-spin" : undefined }), t("action.refresh")),
						h("button", { type: "button", className: "flb-btn flb-btnPrimary", onClick: () => inputRef.current?.click(), disabled: busy !== null },
							h(UploadIcon, { size: 16 }), busy === "upload" ? t("uploading") : t("action.upload")),
						h("input", { ref: inputRef, type: "file", multiple: true, style: { display: "none" }, onChange: onUpload }))),
				h("div", { className: "flb-searchRow" },
					h("div", { className: "flb-search" },
						h(SearchIcon, { size: 16 }),
						h("input", {
							type: "search", value: query, placeholder: t("search.placeholder"),
							onChange: (event) => setQuery(event.target.value),
							"aria-label": t("search.placeholder"),
						}))),
				h("div", { className: "flb-tabs", role: "tablist" },
					tabs.map(([id, label]) => h("button", {
						key: id, type: "button", role: "tab", className: "flb-tab",
						"aria-selected": tab === id, onClick: () => setTab(id),
					}, label))),
				h("div", { className: "flb-body" },
					h("div", { className: "flb-list" },
						library.phase === "loading" && h("div", { className: "flb-empty" }, h("div", { className: "flb-emptyTitle" }, t("loading"))),
						library.phase === "error" && h("div", { className: "flb-empty flb-error", role: "alert" },
							h("div", { className: "flb-emptyTitle" }, t("error")),
							h("div", null, String(library.error?.message ?? "")),
							h("button", { type: "button", className: "flb-btn", onClick: () => library.reload("") }, t("retry"))),
						library.phase !== "loading" && library.phase !== "error" && filtered.length === 0 &&
							h("div", { className: "flb-empty" },
								h("div", { className: "flb-emptyTitle" }, items.length === 0 ? t("empty.title") : t("empty.search")),
								items.length === 0 && h("div", null, t("empty.body"))),
						filtered.map((item) => h("button", {
							key: item.id, type: "button", className: "flb-row",
							"aria-current": selectedId === item.id,
							onClick: () => setSelectedId(item.id),
						},
							h("span", { className: "flb-thumb" },
								item.kind === "image"
									? h("img", { src: rawUrl(item.id), alt: "", loading: "lazy" })
									: h(FileIcon, { size: 20 })),
							h("span", { className: "flb-rowText" },
								h("span", { className: "flb-name" }, item.name || item.id),
								h("span", { className: "flb-sub" }, `${formatBytes(item.bytes)} · ${item.mediaType || item.kind} · ${shortPath(item.readonlyPath ?? "", 64)}`)),
							(item.copies ?? []).length > 0 && h("span", {
								className: `flb-badge ${(item.copies ?? []).some((copy) => copy.state === "modified") ? "flb-badgeMod" : (item.copies ?? []).every((copy) => copy.state === "identical") ? "flb-badgeSame" : ""}`,
								title: (item.copies ?? []).map((copy) => copy.path).join("\n"),
							}, t("count.copies", { count: (item.copies ?? []).length })),
							h("span", {
								className: "flb-star", role: "button", tabIndex: 0, "data-on": item.favorite === true,
								"aria-label": item.favorite ? t("action.unfavorite") : t("action.favorite"),
								onClick: (event) => { event.stopPropagation(); onFavorite(item, !item.favorite) },
								onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); event.preventDefault(); onFavorite(item, !item.favorite) } },
							}, h(StarIcon, { size: 16 }))))),
					h(DetailPanel, { item: selected, t, onFavorite, onClose: () => setSelectedId(null) })))
		}

		// ---------------------------------------------------------------------
		// Sidebar icon (expanded row and collapsed rail both use this)
		// ---------------------------------------------------------------------
		function FileLibraryPanelIcon({ size, active }) {
			return h("svg", {
				viewBox: "0 0 24 24", width: size, height: size, fill: "none",
				"aria-hidden": "true", "data-active": active ? "true" : undefined,
				style: { display: "block", opacity: active ? 1 : 0.86 },
			},
				h("path", { d: "M3.5 7.2c0-1.1.9-2 2-2h3.1c.5 0 1 .2 1.4.6l1.1 1.1c.4.4.9.6 1.4.6h5.9c1.1 0 2 .9 2 2v7.3c0 1.1-.9 2-2 2H5.5c-1.1 0-2-.9-2-2V7.2Z", stroke: "currentColor", strokeWidth: 1.7, strokeLinejoin: "round" }),
				h("path", { d: "M8.2 13.6h7.6M8.2 16.4h4.9", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }),
				active && h("circle", { cx: 17.6, cy: 7.4, r: 2.6, fill: "currentColor", opacity: 0.25 }))
		}

		// ---------------------------------------------------------------------
		// Composer picker: a dropdown anchored above the composer card.
		//
		// It is opened from the composer's "+" menu (a `commandUi` action row), so
		// it renders into `conversation.input.overlay` — the floating layer that
		// lives INSIDE the composer card — instead of a page-level fixed overlay.
		// ---------------------------------------------------------------------

		/**
		 * Which Session's picker is open, plus its transient notice.
		 *
		 * The `+` menu action and the overlay component are separate React trees,
		 * so they share this tiny module-level store rather than props.
		 */
		const pickerStore = { open: false, sessionId: null, notice: null, noticeSessionId: null }
		const pickerListeners = new Set()
		let noticeTimer = null
		function publishPicker(patch) {
			Object.assign(pickerStore, patch)
			for (const listener of [...pickerListeners]) listener()
		}
		function openPicker(sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return
			if (noticeTimer !== null) window.clearTimeout(noticeTimer)
			noticeTimer = null
			publishPicker({ open: true, sessionId, notice: null, noticeSessionId: null })
		}
		function closePicker() {
			if (!pickerStore.open) return
			publishPicker({ open: false })
		}
		function flashPickerNotice(sessionId, text) {
			if (noticeTimer !== null) window.clearTimeout(noticeTimer)
			publishPicker({ notice: text, noticeSessionId: sessionId })
			noticeTimer = window.setTimeout(() => {
				noticeTimer = null
				publishPicker({ notice: null, noticeSessionId: null })
			}, 3600)
		}
		function usePickerStore() {
			const [, bump] = useState(0)
			useEffect(() => {
				const listener = () => bump((value) => value + 1)
				pickerListeners.add(listener)
				return () => {
					pickerListeners.delete(listener)
				}
			}, [])
			return pickerStore
		}

		/** Keep the panel inside the visible viewport and below the native header. */
		function pickerPlacement(composer, reference, viewport, headerBottom = 0) {
			const gap = 4
			const inset = 8
			const viewportTop = viewport.top ?? 0
			const lower = Math.max(viewportTop, viewportTop + viewport.height - inset)
			const upper = Math.min(lower, Math.max(viewportTop + inset, headerBottom + inset))
			const aboveEnd = Math.max(upper, Math.min(lower, composer.top - gap))
			const belowStart = Math.max(upper, Math.min(lower, composer.bottom + gap))
			const above = aboveEnd - upper
			const below = lower - belowStart
			const side = above >= below ? "above" : "below"
			const maxHeight = Math.min(420, side === "above" ? above : below)
			// Native [data-composer-overlay] is a zero-height anchor at the card's
			// top. Measure the actual containing block so a downward panel starts
			// below the entire card, not over the editor.
			return {
				side,
				style: side === "above"
					? { maxHeight, top: "auto", bottom: reference.bottom - aboveEnd }
					: { maxHeight, top: belowStart - reference.top, bottom: "auto" },
			}
		}

		function observePickerPosition(panel, publish) {
			const composer = panel?.closest("[data-composer-card]")
			if (!composer) return () => {}
			const reference = panel.offsetParent ?? panel.closest("[data-composer-overlay]") ?? composer
			const header = document.querySelector?.("[data-conversation-header-leading]")?.closest("header")
			const viewport = window.visualViewport
			let active = true
			const measure = () => {
				if (!active) return
				const next = pickerPlacement(composer.getBoundingClientRect(), reference.getBoundingClientRect(), {
					top: viewport?.offsetTop ?? 0,
					height: viewport?.height ?? window.innerHeight,
				}, header?.getBoundingClientRect().bottom ?? 0)
				publish((previous) => previous?.side === next.side && previous.style.maxHeight === next.style.maxHeight && previous.style.top === next.style.top && previous.style.bottom === next.style.bottom ? previous : next)
			}
			measure()
			const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
			for (const element of new Set([composer, reference, header])) if (element) observer?.observe(element)
			window.addEventListener("resize", measure)
			window.addEventListener("scroll", measure, true)
			viewport?.addEventListener("resize", measure)
			viewport?.addEventListener("scroll", measure)
			return () => {
				active = false
				observer?.disconnect()
				window.removeEventListener("resize", measure)
				window.removeEventListener("scroll", measure, true)
				viewport?.removeEventListener("resize", measure)
				viewport?.removeEventListener("scroll", measure)
			}
		}

		/** The picker panel itself; a plain dropdown, not a modal dialog. */
		function LibraryPicker({ t, onClose, onPick }) {
			const library = useLibrary()
			const [query, setQuery] = useState("")
			const [picked, setPicked] = useState(() => new Set())
			const panelRef = useRef(null)
			const searchRef = useRef(null)
			const [placement, setPlacement] = useState(null)
			useLayoutEffect(() => observePickerPosition(panelRef.current, setPlacement), [])
			const items = useMemo(() => {
				return library.items.filter((item) => matchesQuery(item, query))
			}, [library.items, query])
			const toggle = (id) => setPicked((current) => {
				const next = new Set(current)
				if (next.has(id)) next.delete(id)
				else next.add(id)
				return next
			})
			// A pointer press outside the panel and outside the composer card closes
			// the dropdown, matching how the composer's own menus dismiss.
			useEffect(() => {
				const onPointerDown = (event) => {
					if (!(event.target instanceof Node)) return
					if (panelRef.current?.contains(event.target)) return
					if (panelRef.current?.closest("[data-composer-card]")?.contains(event.target)) return
					onClose()
				}
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return
					event.preventDefault()
					event.stopPropagation()
					onClose()
				}
				searchRef.current?.focus()
				document.addEventListener("pointerdown", onPointerDown, true)
				document.addEventListener("keydown", onKeyDown, true)
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true)
					document.removeEventListener("keydown", onKeyDown, true)
				}
			}, [onClose])
			return h("div", { ref: panelRef, className: "flb-drop", style: placement?.style, "data-placement": placement?.side, role: "dialog", "aria-label": t("attach.title") },
				h("div", { className: "flb-modalHead" },
					h("span", { className: "flb-modalTitle" }, t("attach.title")),
					h("button", { type: "button", className: "flb-btn flb-btnGhost flb-btnIcon", onClick: onClose, "aria-label": t("action.close") }, h(CloseIcon, { size: 16 }))),
				h("div", { className: "flb-searchRow", style: { padding: "8px 12px 6px" } },
					h("div", { className: "flb-search" },
						h(SearchIcon, { size: 16 }),
						h("input", { ref: searchRef, type: "search", value: query, placeholder: t("search.placeholder"), onChange: (event) => setQuery(event.target.value), "aria-label": t("search.placeholder") }))),
				h("div", { className: "flb-modalBody" },
					library.phase === "loading" && h("div", { className: "flb-empty" }, t("loading")),
					library.phase === "error" && h("div", { className: "flb-empty flb-error", role: "alert" },
						`${t("error")}: ${library.error?.message ?? ""}`,
						h("button", { type: "button", className: "flb-btn", onClick: () => library.reload("") }, t("retry"))),
					library.phase !== "loading" && library.phase !== "error" && items.length === 0 && h("div", { className: "flb-empty" }, query.trim() ? t("empty.search") : t("attach.empty")),
					items.map((item) => h("button", {
						key: item.id, type: "button", className: "flb-pick",
						"data-selected": picked.has(item.id),
						onClick: () => toggle(item.id),
					},
						h("span", { className: "flb-check", "data-on": picked.has(item.id) }, picked.has(item.id) ? h(CheckIcon, { size: 12 }) : null),
						h("span", { className: "flb-thumb" }, item.kind === "image" ? h("img", { src: rawUrl(item.id), alt: "", loading: "lazy" }) : h(FileIcon, { size: 18 })),
						h("span", { className: "flb-rowText" },
							h("span", { className: "flb-name" }, item.name || item.id),
							h("span", { className: "flb-sub" }, `${formatBytes(item.bytes)} · ${item.mediaType || item.kind}`))))),
				h("div", { className: "flb-modalFoot" },
					h("span", { className: "flb-sub" }, t("attach.selected", { count: picked.size })),
					h("span", { style: { flex: 1 } }),
					h("button", { type: "button", className: "flb-btn", onClick: onClose }, t("action.cancel")),
					h("button", {
						type: "button", className: "flb-btn flb-btnPrimary", disabled: picked.size === 0,
						onClick: () => onPick(library.items.filter((item) => picked.has(item.id))),
					}, t("attach.add"))))
		}

		/**
		 * Composer overlay: renders the library dropdown and its transient notice
		 * inside the composer card.
		 *
		 * Opened from the composer's "+" menu, this replaces the old standalone
		 * tool-row button, which sat awkwardly beside the permission and plan
		 * controls. `attach` is bound by `apply` because handing files over needs
		 * the Client `conversation` service, resolvable only from that context.
		 */
		function ComposerLibraryOverlay({ t, inputActions, sessionId, attach }) {
			const state = usePickerStore()
			const pending = useRef(null)
			// A hand-off belongs to this mounted Session, including its raw downloads.
			useEffect(() => () => {
				pending.current?.abort()
				pending.current = null
				if (pickerStore.open && pickerStore.sessionId === sessionId) closePicker()
			}, [sessionId])
			if (sessionId === undefined || sessionId === null) return null
			const notice = state.noticeSessionId === sessionId ? state.notice : null
			const open = state.open && state.sessionId === sessionId
			const onPick = async (items) => {
				closePicker()
				if (items.length === 0) return
				pending.current?.abort()
				const controller = new AbortController()
				pending.current = controller
				let result
				try {
					result = await attach(sessionId, inputActions, items, controller.signal)
				} catch {
					result = "failed"
				}
				if (controller.signal.aborted || pending.current !== controller) return
				pending.current = null
				const key = result === "attached" ? "attach.done" : result === "partial" ? "attach.partial" : result === "busy" ? "attach.busy" : result === "unsupported" ? "attach.notSupported" : "attach.failed"
				flashPickerNotice(sessionId, t(key))
			}
			return h(React.Fragment, null,
				notice !== null && !open && h("div", { className: "flb-notice", role: "status" }, notice),
				open && h(LibraryPicker, { key: sessionId, t, onClose: closePicker, onPick }))
		}

		/**
		 * Hand library records to the composer as real draft attachments.
		 *
		 * `inputActions.addAttachments(ids)` accepts only DRAFT-LOCAL ids: the
		 * composer resolves them through `resolveDraftAttachments`, and
		 * `pruneAttachments` drops every id the browser draft registry does not know.
		 * A durable library id (`sha256:<hex>`) therefore cannot be appended
		 * directly — it must first become a browser draft. `conversation.createDrafts`
		 * is the same service entry the shipped composer uses for dropped or pasted
		 * files: it builds an image draft with an object-URL preview, or a file draft
		 * whose background upload starts immediately, and returns the draft ids that
		 * `addAttachments` then appends.
		 *
		 * @returns "attached" | "partial" | "busy" | "unsupported" | "failed" | "cancelled"
		 */
		async function attachToComposer(ctx, sessionId, inputActions, items, signal) {
			if (signal?.aborted) return "cancelled"
			if (inputActions === undefined || inputActions === null) return "unsupported"
			if (typeof inputActions.addAttachments !== "function") return "unsupported"
			if (typeof sessionId !== "string" || sessionId === "") return "unsupported"
			if (typeof ctx?.get !== "function") return "unsupported"
			const conversation = ctx.get("conversation")
			if (!conversation || typeof conversation.createDrafts !== "function" || typeof conversation.releaseDraftAttachments !== "function") return "unsupported"

			const files = []
			for (const item of items) {
				if (signal?.aborted) return "cancelled"
				try {
					const response = await fetch(rawUrl(item.id), { credentials: "same-origin", signal })
					if (!response.ok) continue
					const blob = await response.blob()
					if (signal?.aborted) return "cancelled"
					const type = item.mediaType || blob.type || "application/octet-stream"
					files.push(new File([blob], item.name || "file", { type }))
				} catch {
					if (signal?.aborted) return "cancelled"
					/* one unreadable record must not abort the whole hand-off */
				}
			}
			if (files.length === 0) return "failed"

			const drafts = []
			let accepted = false
			try {
				// Allocate one file at a time so a later allocation failure still leaves
				// all earlier descriptors available for release (image URLs / uploads).
				for (const file of files) {
					if (signal?.aborted) return "cancelled"
					drafts.push(...conversation.createDrafts(sessionId, [file]))
				}
				if (signal?.aborted) return "cancelled"
				const ids = drafts.map((draft) => draft.id).filter((id) => typeof id === "string" && id !== "")
				if (ids.length === 0 || ids.length !== drafts.length || drafts.length !== files.length) return "failed"
				if (inputActions.addAttachments(ids) === false) return "busy"
				accepted = true
				return files.length < items.length ? "partial" : "attached"
			} catch {
				return signal?.aborted ? "cancelled" : "failed"
			} finally {
				if (!accepted && drafts.length > 0) conversation.releaseDraftAttachments(drafts)
			}
		}

		// ---------------------------------------------------------------------
		// Plugin entry
		// ---------------------------------------------------------------------
		return {
			// `commandUi` is the composer "+" menu registry (ui-commands). Declaring
			// it makes Cordis wait for that service, so the menu row is registered
			// during apply instead of racing a later provider.
			inject: ["slots", "locale", "layout", "commandUi", "conversation"],
			apply(ctx) {
				// Install the stylesheet up front: the composer dropdown can mount
				// without the library page ever having rendered.
				ctx.effect(() => installStyles(), "file-library: stylesheet")
				const t = ctx.locale.bind(NS)
				ctx.effect(() => ctx.locale.register(NS, {
					zh: {"home.files":"文件",
						"panel": "文件库", "panel.aria": "打开文件库", "title": "文件库",
						"subtitle": "所有曾输入进 DeepSeek Harness 的文件",
						"search.placeholder": "搜索文件名、路径或会话",
						"tab.all": "全部", "tab.images": "图片", "tab.files": "文件", "tab.favorites": "收藏", "tab.manual": "手动上传",
						"action.upload": "上传文件", "action.refresh": "重新扫描", "action.open": "打开位置", "action.copyPath": "复制路径",
						"action.favorite": "收藏", "action.unfavorite": "取消收藏", "action.attach": "添加到对话", "action.download": "下载",
						"action.close": "关闭", "action.cancel": "取消", "action.confirm": "确定",
						"empty.title": "还没有文件", "empty.body": "在对话里上传图片或文件后，它们会出现在这里。也可以手动上传。",
						"empty.search": "没有匹配的文件", "loading": "正在读取文件库…", "error": "读取文件库失败", "retry": "重试",
						"uploading": "正在上传…", "upload.done": "已上传", "upload.failed": "上传失败", "refresh.done": "已重新扫描",
						"path.readonly": "只读原始路径", "path.readonly.missing": "只读原始路径（文件已不存在）",
						"path.workspace": "工作区副本", "path.workspace.identical": "未修改", "path.workspace.modified": "已修改", "path.workspace.unverified": "内容未核实", "path.none": "暂无工作区副本",
						"meta.size": "大小", "meta.kind": "类型", "meta.created": "首次出现", "meta.sessions": "出现于会话", "meta.dimensions": "尺寸",
						"copy.done": "已复制", "attach.hint": "从资料库添加", "attach.title": "从资料库添加", "attach.empty": "资料库还是空的",
						"attach.menuDescription": "选择已上传过的文件",
						"attach.selected": "已选 {count} 项", "attach.add": "添加",
						"attach.notSupported": "当前输入框无法直接接收资料库文件。",
						"attach.done": "已添加到输入框", "attach.partial": "部分文件已添加，无法读取的文件已跳过", "attach.busy": "输入框正在发送，请稍后再添加", "attach.failed": "添加失败，请重试",
						"count.items": "{count} 个文件", "count.copies": "{count} 个副本",
						"detail.title": "文件详情", "detail.sessions": "使用记录", "scan.info": "扫描于 {time}", "sidebar.more": "更多",
					},
					en: {
						"panel": "File Library", "panel.aria": "Open File Library", "title": "File Library",
						"subtitle": "Every file ever uploaded into DeepSeek Harness",
						"search.placeholder": "Search name, path, or session",
						"tab.all": "All", "tab.images": "Images", "tab.files": "Files", "tab.favorites": "Favorites", "tab.manual": "Uploaded",
						"action.upload": "Upload file", "action.refresh": "Rescan", "action.open": "Reveal", "action.copyPath": "Copy path",
						"action.favorite": "Favorite", "action.unfavorite": "Unfavorite", "action.attach": "Add to conversation", "action.download": "Download",
						"action.close": "Close", "action.cancel": "Cancel", "action.confirm": "Confirm",
						"empty.title": "No files yet", "empty.body": "Images and files you upload in a conversation appear here. You can also upload manually.",
						"empty.search": "No matching files", "loading": "Loading the file library…", "error": "Could not read the file library", "retry": "Retry",
						"uploading": "Uploading…", "upload.done": "Uploaded", "upload.failed": "Upload failed", "refresh.done": "Rescanned",
						"path.readonly": "Read-only original path", "path.readonly.missing": "Read-only original path (file missing)",
						"path.workspace": "Workspace copy", "path.workspace.identical": "Unmodified", "path.workspace.modified": "Modified", "path.workspace.unverified": "Content not verified", "path.none": "No workspace copy",
						"meta.size": "Size", "meta.kind": "Type", "meta.created": "First seen", "meta.sessions": "Sessions", "meta.dimensions": "Dimensions",
						"copy.done": "Copied", "attach.hint": "Add from library", "attach.title": "Add from library", "attach.empty": "The library is empty",
						"attach.menuDescription": "Pick a file you already uploaded",
						"attach.selected": "{count} selected", "attach.add": "Add",
						"home.files":"Files",
                        "attach.notSupported": "This composer cannot take library files directly.",
						"attach.done": "Added to the composer", "attach.partial": "Some files were added; unreadable files were skipped", "attach.busy": "The composer is sending; try again in a moment", "attach.failed": "Could not add the files; try again",
						"count.items": "{count} files", "count.copies": "{count} copies",
						"detail.title": "File details", "detail.sessions": "Usage", "scan.info": "Scanned at {time}", "sidebar.more": "More",
					},
				}), "file-library: dictionaries")

				// Global panel page in the main column.
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					locale: NS,
				}, FileLibraryPage))

				// Sidebar entry: expanded row shows the label, the collapsed rail keeps
				// the icon, and the icon marks itself when this panel is active.
				ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 20,
					label: () => t("panel"),
					locale: NS,
				}, FileLibraryPanelIcon))

				// Composer integration: a row in the composer's "+" menu (the same
				// menu that holds "文件"), plus the dropdown it opens. `attach` is
				// bound here because the hand-off needs the Client `conversation`
				// service, resolvable only from this plugin context.
				const attach = (sessionId, inputActions, items, signal) => attachToComposer(ctx, sessionId, inputActions, items, signal)
				ctx.effect(() => () => {
					if (noticeTimer !== null) window.clearTimeout(noticeTimer)
					noticeTimer = null
					publishPicker({ open: false, sessionId: null, notice: null, noticeSessionId: null })
				}, "file-library: picker state")

				// The "+" menu is the ui-commands "/" source: a client contribution
				// with an `action` UI runs directly instead of opening a command
				// popup. Registering here keeps the control out of the composer tool
				// row, where it sat awkwardly beside permission and plan.
				const commands = typeof ctx.get === "function" ? ctx.get("commandUi") : undefined
				if (commands !== undefined && commands !== null && typeof commands.register === "function") {
					ctx.effect(() => commands.register({
						name: "library",
						label: () => t("attach.hint"),
						description: () => t("attach.menuDescription"),
						icon: FolderIcon,
						available: (session) => session !== undefined && session !== null && typeof session.sessionId === "string",
						ui: {
							kind: "action",
							run: (session) => {
								openPicker(session.sessionId)
							},
						},
					}), "file-library: composer menu row")
				}

				// Direct home entry, sharing the existing picker and real draft attachments.
                function HomeFiles({sessionId,t}) {
                    const state=usePickerStore();
                    return h('button',{type:'button',className:'dsh-home-files','aria-label':t('home.files'),'aria-haspopup':'dialog','aria-expanded':state.open&&state.sessionId===sessionId,disabled:!sessionId,onClick:()=>{if(state.open&&state.sessionId===sessionId)closePicker();else openPicker(sessionId);}},h(FileIcon,{size:16}),t('home.files'));
                }
                ctx.slots.inject('conversation.hero.options',()=>ctx.slots.register({name:'conversation.hero.options',id:'home-files',order:0,locale:NS},HomeFiles));
                // The dropdown lives inside the composer card, above the editor.
				const ComposerEntry = (props) => h(ComposerLibraryOverlay, { ...props, attach })
				ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
					name: "conversation.input.overlay",
					id: "file-library-picker",
					order: 10,
					locale: NS,
				}, ComposerEntry))
			},
		}
	},
})
