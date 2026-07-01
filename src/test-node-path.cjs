"use strict";

const path = require("node:path");
const Module = require("node:module");

const dependencyPaths = [
  path.join(__dirname, "node_modules"),
  path.join(__dirname, "..", "node_modules"),
];

process.env.NODE_PATH = [
  ...dependencyPaths,
  process.env.NODE_PATH || "",
].filter(Boolean).join(path.delimiter);

Module._initPaths();
