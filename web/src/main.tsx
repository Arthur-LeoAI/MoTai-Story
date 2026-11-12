import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import App from "./App";
import { detectInitialLocale, initI18n } from "./i18n";
import { applyTheme, detectInitialTheme } from "./theme";

const theme = detectInitialTheme();
applyTheme(theme);

void initI18n(detectInitialLocale()).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initialTheme={theme} />
    </StrictMode>
  );
});
