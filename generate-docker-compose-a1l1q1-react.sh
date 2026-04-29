#!/bin/bash

# Accept UserID as an argument
USER_ID=$1
EMPLOYEE_NO=$(echo "$2" | tr '[:upper:]' '[:lower:]')
DOCKER_PORT=$3
OUTPUT_PORT=$4
SERVER=$5

if [ -z "$EMPLOYEE_NO" ]; then
  echo "Usage: ./generate-docker-compose-a1l1.sh <EMPLOYEE_NO>"
  exit 1
fi

# Variables
PORT=$((8080 + USER_ID))
CONTAINER_NAME="code-server-a1l1q1-react-${EMPLOYEE_NO}"
# PASSWORD="test"
# IMAGE_NAME="krishnapriyap/merntest:latest"

# Generate Docker Compose file content
COMPOSE_CONTENT=$(cat <<EOF
version: '3.8'

services:
  code-server:
    container_name: "${CONTAINER_NAME}"
    image: "sankarkg/level-one-test:latest"
    ports:
      - "${DOCKER_PORT}:8080"
      - "${OUTPUT_PORT}:5173"
    volumes:
      - frontend-src-${EMPLOYEE_NO}:/home/coder/project/src
    environment:
      - WATCHPACK_POLLING=true
    command:
        code-server --bind-addr 0.0.0.0:8080 --auth none /home/coder/project
    networks:
      - my_network

networks:
  my_network:
    external: true
    name: aon-network

volumes:
  frontend-src-${EMPLOYEE_NO}:
    driver: local

EOF
)

# Debug: Print the calculated port
echo "Calculated Docker Port for Aon ID ${EMPLOYEE_NO}: ${DOCKER_PORT}"
echo "Calculated Output Port for Aon ID ${EMPLOYEE_NO}: ${OUTPUT_PORT}"

# Debug: Print the Docker Compose file content
echo "Docker Compose Content:"
echo "$COMPOSE_CONTENT"

# Save the content to a Docker Compose file
COMPOSE_FILE_NAME="docker-compose-a1l1q1-react-${EMPLOYEE_NO}.yml"
echo "$COMPOSE_CONTENT" > "$COMPOSE_FILE_NAME"

chmod +x "$COMPOSE_FILE_NAME"

# Run Docker Compose to start the containers
docker compose -f "$COMPOSE_FILE_NAME" -p a1l1q1-react-${EMPLOYEE_NO} up -d

# Wait for container to be ready
echo "Waiting for container to start..."
sleep 3

docker exec $CONTAINER_NAME bash -c "cat > /home/coder/project/vite.config.js << VITEEOF
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  base: '/container-server/${SERVER}/out/${OUTPUT_PORT}',
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['aws-test.starsquare.in', 'assessment.kggeniuslabs.com'],
  }
})
VITEEOF

chmod 444 /home/coder/project/vite.config.js
"

echo "✅ vite.config.js injected for port ${OUTPUT_PORT}"

# Restart Vite to pick up new config
docker exec $CONTAINER_NAME bash -c "pkill -f vite; cd /home/coder/project && npm run dev > /dev/null 2>&1 &"

echo "✅ Vite restarted with base /container-server/${SERVER}/out/${OUTPUT_PORT}/"