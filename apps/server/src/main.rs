fn main() {
    let config = bookvault_server::state::ServerConfig::from_env();
    bookvault_server::run(config);
}
