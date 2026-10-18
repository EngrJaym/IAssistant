import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "./services/theme";
import "./styles.css";

initTheme();
createRoot(document.getElementById("root")!).render(<App />);
