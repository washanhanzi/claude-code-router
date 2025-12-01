FROM node:20-alpine

RUN npm install -g @washanhanzi/claude-code-router

EXPOSE 3456

CMD ["ccr",  "start"]
