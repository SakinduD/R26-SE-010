# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_MEDIAPIPE_FACE_MESH_URL
ARG VITE_AVATAR_URL
ARG VITE_RPE_TTS_PROVIDER
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_MEDIAPIPE_FACE_MESH_URL=$VITE_MEDIAPIPE_FACE_MESH_URL
ENV VITE_AVATAR_URL=$VITE_AVATAR_URL
ENV VITE_RPE_TTS_PROVIDER=$VITE_RPE_TTS_PROVIDER
RUN npm run build

# Serve stage
FROM nginx:alpine
# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html
# Copy custom Nginx configuration if needed, otherwise use default
# COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
