# Development workfow

## Bootstrap on WSL2 Ubuntu

```bash
sudo apt update
sudo apt install -y curl ca-certificates git build-essential

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash

# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

nvm install 24
#  nvm install 22
nvm alias default 24

node --version
npm --version
```

## Retest

```bash
npm ci
npm run compile
npm test
npx @vscode/vsce package
```
