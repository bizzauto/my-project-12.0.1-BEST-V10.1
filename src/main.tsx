import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./lib/i18n"; // Initialize i18next before any component uses useTranslation
import AppWrapper from "./AppWrapper";
import { getStoredTheme, getThemeById, applyTheme } from "./lib/themes";
import { initPostHog } from "./lib/posthog-client";

// Apply saved theme before render to prevent flash
const savedTheme = getStoredTheme();
applyTheme(getThemeById(savedTheme));

// Initialize PostHog analytics (client-side)
initPostHog();

console.log('App starting...');

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>
);
