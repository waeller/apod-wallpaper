@echo off

if NOT EXIST .\node_modules call npm install --production

node index.js %1