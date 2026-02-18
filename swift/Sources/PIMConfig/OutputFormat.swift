import ArgumentParser
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// Output format for CLI commands.
public enum OutputFormat: String, CaseIterable, ExpressibleByArgument {
    case json
    case text
}

/// Determines output format based on explicit flag or TTY detection.
public struct OutputContext {
    public let format: OutputFormat

    public init(explicit: OutputFormat? = nil) {
        if let explicit {
            self.format = explicit
        } else {
            self.format = isatty(STDOUT_FILENO) != 0 ? .text : .json
        }
    }

    public var isJSON: Bool { format == .json }
    public var isText: Bool { format == .text }
}
