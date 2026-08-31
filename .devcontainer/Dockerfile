FROM mcr.microsoft.com/devcontainers/rust:1

# Use Rust toolchain
RUN rustup toolchain add 1.89.0 && rustup default 1.89.0

# Install required system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (matching .nvmrc version 20)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install just
RUN cargo install just --version 1.54.0

# Add Soroban wasm target
RUN rustup target add wasm32-unknown-unknown

# Install Stellar CLI using pre-built binary
RUN curl -fsSL https://github.com/stellar/stellar-cli/releases/download/v23.4.1/stellar-cli-23.4.1-x86_64-unknown-linux-gnu.tar.gz -o /tmp/stellar-cli.tar.gz && \
    tar -xzf /tmp/stellar-cli.tar.gz -C /usr/local/bin && \
    rm /tmp/stellar-cli.tar.gz && \
    chmod +x /usr/local/bin/stellar && \
    mv /usr/local/bin/stellar /usr/local/bin/stellar-cli

# Install circom 2.2.3
RUN git clone https://github.com/iden3/circom.git /tmp/circom && \
    cd /tmp/circom && \
    git checkout v2.2.3 && \
    cargo build --release && \
    cp target/release/circom /usr/local/bin/circom && \
    rm -rf /tmp/circom