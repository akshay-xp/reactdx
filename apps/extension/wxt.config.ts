import { toolbarIcons } from "@reactdx/messages"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  // The polyfill fetches preload links; both browsers support modulepreload natively, and shipped code must make no network calls.
  vite: () => ({
    plugins: [tailwindcss()],
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: ({ browser }) => ({
    name: "ReactDX",
    icons: toolbarIcons("development"),
    // The background sets each tab's icon and title once React connects.
    action: {
      default_title: "ReactDX: no React",
      default_icon: toolbarIcons("none"),
    },
    permissions: ["scripting", "storage"],
    // Chrome needs it for scripting.executeScript (the agent); same warning as the content scripts.
    host_permissions: ["<all_urls>"],
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "reactdx@akxp.net",
          // world: "MAIN" content scripts arrived in Firefox 128.
          strict_min_version: "128.0",
          // ReactDX never sends data anywhere.
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),
  }),
})
