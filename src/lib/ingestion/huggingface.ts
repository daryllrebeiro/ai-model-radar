import { HuggingFaceModel, CommunityEvent } from '@/types/community';

const HF_API_URL = 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50';

/**
 * Fetches trending and new community models from Hugging Face's public API
 */
export async function fetchHuggingFaceTrending(limit = 40): Promise<HuggingFaceModel[]> {
  try {
    const url = `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${limit}&full=false`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AI-Model-Radar/1.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => {
      const id = item.id || item._id;
      const parts = id.split('/');
      const author = parts.length > 1 ? parts[0] : 'Community';
      const name = parts.length > 1 ? parts[1] : id;

      return {
        id,
        author,
        name,
        downloads: item.downloads || 0,
        likes: item.likes || 0,
        pipeline_tag: item.pipeline_tag || 'text-generation',
        tags: item.tags || [],
        trendingScore: item.trendingScore || 0,
        lastModified: item.lastModified || new Date().toISOString(),
        created_at: item.createdAt || item.lastModified || new Date().toISOString(),
      };
    });
  } catch (error) {
    console.error('Failed to fetch Hugging Face models, using fallback fixtures:', error);
    return getFallbackHFModels();
  }
}

/**
 * Fallback models for offline or rate-limited environments
 */
export function getFallbackHFModels(): HuggingFaceModel[] {
  return [
    {
      id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      author: 'deepseek-ai',
      name: 'DeepSeek-R1-Distill-Qwen-32B',
      downloads: 1450200,
      likes: 4890,
      pipeline_tag: 'text-generation',
      tags: ['nlp', 'reasoning', 'r1', 'qwen'],
      trendingScore: 98.4,
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct',
      author: 'meta-llama',
      name: 'Llama-3.3-70B-Instruct',
      downloads: 2890400,
      likes: 6120,
      pipeline_tag: 'text-generation',
      tags: ['llama-3.3', 'instruct', 'open-weights'],
      trendingScore: 95.1,
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'mistralai/Mistral-Small-24B-Instruct-2501',
      author: 'mistralai',
      name: 'Mistral-Small-24B-Instruct-2501',
      downloads: 620100,
      likes: 2450,
      pipeline_tag: 'text-generation',
      tags: ['mistral', 'reasoning', 'instruct'],
      trendingScore: 89.2,
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      author: 'Qwen',
      name: 'Qwen2.5-Coder-32B-Instruct',
      downloads: 1890300,
      likes: 5120,
      pipeline_tag: 'text-generation',
      tags: ['code', 'qwen2.5', 'coder'],
      trendingScore: 92.7,
      created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'black-forest-labs/FLUX.1-schnell',
      author: 'black-forest-labs',
      name: 'FLUX.1-schnell',
      downloads: 3450900,
      likes: 8920,
      pipeline_tag: 'text-to-image',
      tags: ['flux', 'image-gen', 'diffusion'],
      trendingScore: 94.8,
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'google/gemma-2-27b-it',
      author: 'google',
      name: 'gemma-2-27b-it',
      downloads: 980400,
      likes: 3100,
      pipeline_tag: 'text-generation',
      tags: ['gemma-2', 'instruction-tuned'],
      trendingScore: 84.3,
      created_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}
