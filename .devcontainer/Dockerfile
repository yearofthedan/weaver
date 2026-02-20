FROM mcr.microsoft.com/devcontainers/javascript-node:24

USER root
RUN mkdir -p /home/node/.vscode-server/extensions \
    && mkdir -p /home/node/.vscode-server/data/User/globalStorage \
    && chown -R node:node /home/node/.vscode-server

USER node