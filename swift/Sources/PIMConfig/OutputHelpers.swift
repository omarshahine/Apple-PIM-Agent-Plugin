import Foundation

/// Prints JSON or human-readable text based on the output context.
public func pimOutput(_ jsonValue: Any, text: String, context: OutputContext) {
    if context.isJSON {
        if let data = try? JSONSerialization.data(withJSONObject: jsonValue, options: [.prettyPrinted, .sortedKeys]),
           let string = String(data: data, encoding: .utf8) {
            print(string)
        }
    } else {
        print(text)
    }
}
