import "./application.scss";

import { App } from "../App";
import React from "react";
import ReactDOM from "react-dom";

(function() {
  ReactDOM.render(
    <App />,
    document.body.appendChild(document.createElement("div")),
  );
})();
