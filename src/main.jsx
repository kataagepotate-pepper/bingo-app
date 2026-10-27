import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "./pages/Home.jsx";
import Host from "./pages/Host.jsx";
import Join from "./pages/Join.jsx";
import "./styles.css";

export function navigate(to) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

function Router() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const [, page, rawId] = path.split("/");
  const id = (rawId || "").toUpperCase();
  if (page === "host" && id) return <Host id={id} />;
  if (page === "screen" && id) return <Host id={id} screenOnly />;
  if (page === "join" && id) return <Join id={id} />;
  return <Home />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
