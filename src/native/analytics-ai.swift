import Foundation
import FoundationModels

struct Field: Decodable {
    let type: String
    let values: [String]?
    let minimum: Int?
    let maximum: Int?
    let description: String?
    enum CodingKeys: String, CodingKey {
        case type, minimum, maximum, description
        case values = "enum"
    }
}

struct Schema: Decodable {
    let properties: [String: Field]
    let required: [String]
}

struct Request: Decodable {
    let instructions: String
    let prompt: String
    let schema: Schema
}

@main
struct AnalyticsAI {
    static func main() async {
        do {
            guard #available(macOS 26.0, *) else {
                print("{\"available\":false}")
                return
            }
            // Explicitly select the on-device model; never use Private Cloud Compute.
            let model = SystemLanguageModel.default
            guard model.availability == .available else {
                if CommandLine.arguments.contains("--check") {
                    print("{\"available\":false}")
                    return
                }
                throw NSError(domain: "AMP22", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "The on-device Apple model is no longer available."
                ])
            }
            if CommandLine.arguments.contains("--check") {
                print("{\"available\":true}")
                return
            }
            let request = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
            let properties = try request.schema.required.map { name in
                guard let field = request.schema.properties[name] else {
                    throw NSError(domain: "AMP22", code: 2, userInfo: [
                        NSLocalizedDescriptionKey: "Missing query schema field."
                    ])
                }
                let schema: DynamicGenerationSchema
                if let values = field.values {
                    schema = DynamicGenerationSchema(name: name, anyOf: values)
                } else if field.type == "integer", let minimum = field.minimum, let maximum = field.maximum {
                    schema = DynamicGenerationSchema(type: Int.self, guides: [.range(minimum...maximum)])
                } else {
                    schema = DynamicGenerationSchema(type: String.self)
                }
                return DynamicGenerationSchema.Property(name: name, description: field.description, schema: schema)
            }
            let schema = try GenerationSchema(
                root: DynamicGenerationSchema(name: "AnalyticsQuery", properties: properties),
                dependencies: []
            )
            let session = LanguageModelSession(model: model, instructions: request.instructions)
            let response = try await session.respond(
                to: request.prompt,
                schema: schema,
                options: GenerationOptions(temperature: 0)
            )
            FileHandle.standardOutput.write(Data(response.content.jsonString.utf8))
        } catch {
            let data = try? JSONSerialization.data(withJSONObject: ["error": error.localizedDescription])
            FileHandle.standardOutput.write(data ?? Data("{\"error\":\"Native model request failed.\"}".utf8))
            exit(1)
        }
    }
}
