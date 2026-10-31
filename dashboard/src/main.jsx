import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";

createRoot(document.getElementById("root")).render(<App />);
