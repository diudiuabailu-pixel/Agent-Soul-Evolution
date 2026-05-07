export type OllamaModel = {
  name: string;
  size?: number;
  modified_at?: string;
};

export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<OllamaModel[]> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/tags`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to list Ollama models: ${response.status}`);
  }
  const data = await response.json() as { models?: OllamaModel[] };
  return data.models || [];
}
