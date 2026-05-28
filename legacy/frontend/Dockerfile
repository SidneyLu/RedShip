FROM docker.m.daocloud.io/library/node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 8006

CMD ["npm", "run", "dev"]
