import { Panel } from "@reactdx/panel"
import { applyTheme, defaultTheme, type Theme } from "@reactdx/panel/themes"
import { render } from "solid-js/web"
import "@reactdx/panel/index.css"
import { getTheme, onThemeChanged } from "./theme"

const apply = (theme: Theme) => applyTheme(theme, document.documentElement)
apply(defaultTheme(getTheme()))
onThemeChanged((kind) => apply(defaultTheme(kind)))

render(() => <Panel />, document.getElementById("app") as HTMLElement)
