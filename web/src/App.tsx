import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import WorkFrame, { NotFound } from "./pages/WorkFrame";
import { PreferencesProvider } from "./preferences";
import type { Theme } from "./theme";

// The app is served under /app/ (see web/vite.config.ts and server.js).
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App({ initialTheme }: { initialTheme: Theme }) {
  return (
    <PreferencesProvider initialTheme={initialTheme}>
      <BrowserRouter basename={BASENAME}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/works/:workId/:section" element={<WorkFrame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </PreferencesProvider>
  );
}
