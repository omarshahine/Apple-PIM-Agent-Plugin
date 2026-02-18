import ArgumentParser

/// Shared CLI options for all PIM CLIs.
/// Add as `@OptionGroup var pimOptions: PIMOptions` in subcommands that need config access.
public struct PIMOptions: ParsableArguments {
    @Option(name: .long, help: "Configuration profile name (loads from ~/.config/apple-pim/profiles/{name}.json)")
    public var profile: String?

    @Option(name: .long, help: "Output format: json or text (default: auto-detect from TTY)")
    public var format: OutputFormat?

    public init() {}

    /// Load the resolved configuration (base + profile override).
    public func loadConfig() -> PIMConfiguration {
        ConfigLoader.load(profile: profile)
    }

    /// Output context derived from explicit --format flag or TTY auto-detection.
    public var outputContext: OutputContext {
        OutputContext(explicit: format)
    }
}
