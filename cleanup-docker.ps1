param(
    [string]$question,
    [string]$framework,
    [string]$userId
)

# Construct names from inputs
$containerName = "code-server-$question-$framework-$userId"
$imageName = "sankarkg/$question-$framework"

Write-Output "$userId : Starting Docker cleanup..."
Write-Output "$userId : Target container: $containerName"
# Write-Output "[$userId] 🖼️  Target image: $imageName"

# Stop and remove the container if it exists
$containerId = docker ps -a -q --filter "name=$containerName"
if ($containerId) {
    Write-Output "$userId : Stopping and removing container: $containerName"
    docker rm -f $containerId | Out-Null
    Write-Output "$userId : Container removed: $containerName"
} else {
    Write-Output "$userId : No container found with name: $containerName"
}

# # Remove the Docker image if it exists
# $imageId = docker images -q $imageName
# if ($imageId) {
#     docker rmi -f $imageId | Out-Null
#     Write-Output "✅ Removed image: $imageName"
# } else {
#     Write-Output "⚠️  No image found with name: $imageName"
# }

# Optional: clean up any dangling volumes/networks if needed
# docker volume prune -f
# docker network prune -f

Write-Output "$userId : Docker cleanup completed."
