FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server/

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/server .
COPY --from=builder /app/internal/web/templates ./internal/web/templates
COPY --from=builder /app/internal/web/static ./internal/web/static
COPY --from=builder /app/internal/chain/abis ./internal/chain/abis
COPY --from=builder /app/internal/chain/abi ./internal/chain/abi

EXPOSE 8181
CMD ["./server"]
