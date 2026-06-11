@echo off
cd /d "%~dp0"
start "" http://localhost:8741
node server.mjs 8741
