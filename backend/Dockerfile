FROM golang:1.25-alpine AS build
WORKDIR /app
RUN apk add --no-cache git

COPY go.mod ./
COPY . .

# go.mod intentionally has no pinned requires/go.sum committed; this resolves
# and locks the actual dependency graph against the module proxy at build time.
RUN go mod tidy
RUN go build -o /gigavault-server ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /gigavault-server /usr/local/bin/gigavault-server
EXPOSE 8080
CMD ["gigavault-server"]
