FROM mcr.microsoft.com/devcontainers/javascript-node:24

USER root
RUN mkdir -p /home/node/.vscode-server/extensions \
    && mkdir -p /home/node/.vscode-server/data/User/globalStorage \
    && chown -R node:node /home/node/.vscode-server

COPY ./onCreate.sh /usr/local/bin/onCreate.sh
RUN chmod +x /usr/local/bin/onCreate.sh

COPY ./postStart.sh /usr/local/bin/postStart.sh
RUN chmod +x /usr/local/bin/postStart.sh

USER node