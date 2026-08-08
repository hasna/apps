#!/usr/bin/env bash
set -euo pipefail

: "${ECR_URL:?ECR_URL is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

IMAGE_TAG="${GITHUB_SHA}"
ECR_REPOSITORY="${ECR_URL#*/}"
: "${ECR_REPOSITORY:?ECR_URL must include an ECR repository}"

LOOKUP_OUTPUT="$(mktemp)"
LOOKUP_ERROR="$(mktemp)"
cleanup() {
  rm -f "$LOOKUP_OUTPUT" "$LOOKUP_ERROR"
}
trap cleanup EXIT

set +e
aws ecr list-images \
  --repository-name "$ECR_REPOSITORY" \
  --filter tagStatus=TAGGED \
  --query "imageIds[?imageTag=='${IMAGE_TAG}'].imageDigest | [0]" \
  --output text \
  >"$LOOKUP_OUTPUT" \
  2>"$LOOKUP_ERROR"
LOOKUP_STATUS=$?
set -e

if [ "$LOOKUP_STATUS" -ne 0 ]; then
  cat "$LOOKUP_ERROR" >&2
  echo "::error::failed to determine whether ${ECR_URL}:${IMAGE_TAG} exists in ECR" >&2
  exit "$LOOKUP_STATUS"
fi

DIGEST="$(<"$LOOKUP_OUTPUT")"
if [ "$DIGEST" = "None" ]; then
  IMAGE="${ECR_URL}:${IMAGE_TAG}"
  echo "Source tag ${IMAGE} is absent; building and pushing native arm64 image"
  docker buildx build \
    --platform linux/arm64 \
    --provenance=false \
    --cache-from "type=gha" \
    --cache-to "type=gha,mode=max" \
    --build-arg "BUILD_SHA=${GITHUB_SHA}" \
    --build-arg "REQUIRE_BUILD_SHA=1" \
    --tag "$IMAGE" \
    --push \
    .

  DIGEST="$(aws ecr describe-images \
    --repository-name "$ECR_REPOSITORY" \
    --image-ids "imageTag=${IMAGE_TAG}" \
    --query 'imageDetails[0].imageDigest' \
    --output text)"
else
  if [ -z "$DIGEST" ]; then
    echo "::error::ECR returned an empty digest lookup for ${ECR_URL}:${IMAGE_TAG}" >&2
    exit 1
  fi
  echo "Source tag ${ECR_URL}:${IMAGE_TAG} exists; reusing digest ${DIGEST}"
fi

if [ -z "$DIGEST" ] || [ "$DIGEST" = "None" ]; then
  echo "::error::ECR did not return a digest for ${ECR_URL}:${IMAGE_TAG}" >&2
  exit 1
fi

IMAGE="${ECR_URL}@${DIGEST}"
{
  echo "image=${IMAGE}"
  echo "digest=${DIGEST}"
  echo "tag=${IMAGE_TAG}"
} >>"$GITHUB_OUTPUT"
echo "Resolved ${ECR_URL}:${IMAGE_TAG} to ${IMAGE}"
