import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import MangaStudioApp from "./App.jsx";
import BookApp from "./BookApp.jsx";
import StudioPicker from "./StudioPicker.jsx";
import "./index.css";
import "./main-shell.css";

// Top-level entry point: which studio ("manga" or "html") is active, if any — persisted
// so a returning visitor lands straight back in the same studio instead of re-picking
// every time. App.jsx (Manga Studio) is imported and rendered completely unchanged —
// only this file decides which studio to show; the floating "Studios" button below is
// how you get back to the picker from EITHER studio, since App.jsx itself is never
// modified to add a link like BookApp.jsx's own.
function Shell() {
  const [studio, setStudio] = useState(() => localStorage.getItem("studio") || null);

  const pickStudio = (next) => {
    localStorage.setItem("studio", next);
    setStudio(next);
  };
  const backToStudios = () => {
    localStorage.removeItem("studio");
    setStudio(null);
  };

  return (
    <>
      {studio && (
        <button className="studio-switcher-fab" onClick={backToStudios}>
          ☰ Studios
        </button>
      )}
      {studio === "manga" ? (
        <MangaStudioApp />
      ) : studio === "html" ? (
        <BookApp onBackToStudios={backToStudios} />
      ) : (
        <StudioPicker onPick={pickStudio} />
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
