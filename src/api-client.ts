/**
 * LinkedIn API Client
 *
 * Base URL: https://api.linkedin.com/v2
 * Auth: Bearer token (Authorization: Bearer {access_token})
 * Request bodies: application/json
 * Responses: JSON
 * Pagination: start/count based
 *
 * Products used:
 *   - Share on LinkedIn (w_member_social)
 *   - Sign In with LinkedIn using OpenID Connect (openid, profile, email)
 */

const BASE_URL = 'https://api.linkedin.com/v2';

export class LinkedInClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: Record<string, any>;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
      rawBody?: Uint8Array;
      rawContentType?: string;
      baseUrl?: string;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, params, rawBody, rawContentType, baseUrl } = options;
    const base = baseUrl || BASE_URL;
    const url = new URL(`${base}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
      'LinkedIn-Version': '202506',
      ...options.headers,
    };

    let requestBody: any;
    if (rawBody) {
      headers['Content-Type'] = rawContentType || 'application/octet-stream';
      requestBody = rawBody;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(requestBody ? { body: requestBody as BodyInit } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkedIn API Error ${response.status}: ${text}`);
    }

    // Some endpoints return 201/204 with no body
    const text = await response.text();
    if (!text || text.trim() === '') {
      // For POST/PUT/DELETE that return empty body, extract resource ID from headers
      const linkedinId = response.headers.get('x-linkedin-id') || response.headers.get('x-restli-id');
      return (linkedinId ? { id: linkedinId, status: response.status } : { status: response.status }) as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text, status: response.status } as T;
    }
  }

  // --- Profile ---

  /** Get authenticated user's profile via OpenID Connect */
  async getUserInfo(): Promise<any> {
    return this.request<any>('/userinfo');
  }

  // --- Posts (newer API) ---

  /** Create a text post */
  async createPost(params: {
    authorUrn: string;
    text: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<any> {
    return this.request<any>('/posts', {
      method: 'POST',
      body: {
        author: params.authorUrn,
        commentary: params.text,
        visibility: params.visibility || 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
      },
    });
  }

  /** Create a post with a link/article */
  async createArticlePost(params: {
    authorUrn: string;
    text: string;
    articleUrl: string;
    articleTitle?: string;
    articleDescription?: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<any> {
    return this.request<any>('/posts', {
      method: 'POST',
      body: {
        author: params.authorUrn,
        commentary: params.text,
        visibility: params.visibility || 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          article: {
            source: params.articleUrl,
            title: params.articleTitle,
            description: params.articleDescription,
          },
        },
        lifecycleState: 'PUBLISHED',
      },
    });
  }

  /** Create a post with an uploaded image */
  async createImagePost(params: {
    authorUrn: string;
    text: string;
    imageUrn: string;
    altText?: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<any> {
    return this.request<any>('/posts', {
      method: 'POST',
      body: {
        author: params.authorUrn,
        commentary: params.text,
        visibility: params.visibility || 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            id: params.imageUrn,
            altText: params.altText,
          },
        },
        lifecycleState: 'PUBLISHED',
      },
    });
  }

  /** Get a specific post by URN */
  async getPost(postUrn: string): Promise<any> {
    return this.request<any>(`/posts/${encodeURIComponent(postUrn)}`);
  }

  /** Delete a post */
  async deletePost(postUrn: string): Promise<any> {
    return this.request<any>(`/posts/${encodeURIComponent(postUrn)}`, {
      method: 'DELETE',
    });
  }

  /** List posts by author */
  async listPosts(authorUrn: string, count?: number, start?: number): Promise<any> {
    return this.request<any>('/posts', {
      params: {
        q: 'author',
        author: authorUrn,
        count: count || 10,
        start: start || 0,
      },
    });
  }

  // --- Image Upload ---

  /** Initialize an image upload — returns uploadUrl and image URN */
  async initializeImageUpload(ownerUrn: string): Promise<any> {
    return this.request<any>('/images', {
      method: 'POST',
      params: { action: 'initializeUpload' },
      body: {
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      },
    });
  }

  /** Upload binary image data to the URL from initializeImageUpload */
  async uploadImage(uploadUrl: string, imageData: Uint8Array, contentType: string): Promise<any> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': contentType,
      },
      body: imageData as any as BodyInit,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkedIn Image Upload Error ${response.status}: ${text}`);
    }

    return { success: true };
  }

  // --- Reactions ---

  /** React to a post (like/celebrate/etc.) */
  async createReaction(actorUrn: string, postUrn: string, reactionType: string): Promise<any> {
    return this.request<any>(`/socialActions/${encodeURIComponent(postUrn)}/likes`, {
      method: 'POST',
      body: {
        actor: actorUrn,
        object: postUrn,
      },
    });
  }

  /** Remove a like from a post */
  async deleteReaction(actorUrn: string, postUrn: string): Promise<any> {
    return this.request<any>(`/socialActions/${encodeURIComponent(postUrn)}/likes`, {
      method: 'DELETE',
      params: { actor: actorUrn },
    });
  }

  /** Get likes on a post */
  async getReactions(postUrn: string, count?: number, start?: number): Promise<any> {
    return this.request<any>(`/socialActions/${encodeURIComponent(postUrn)}/likes`, {
      params: {
        count: count || 10,
        start: start || 0,
      },
    });
  }

  // --- Comments ---

  /** Create a comment on a post */
  async createComment(postUrn: string, actorUrn: string, text: string): Promise<any> {
    return this.request<any>(`/socialActions/${encodeURIComponent(postUrn)}/comments`, {
      method: 'POST',
      body: {
        actor: actorUrn,
        message: { text },
      },
    });
  }

  /** Get comments on a post */
  async getComments(postUrn: string, count?: number, start?: number): Promise<any> {
    return this.request<any>(`/socialActions/${encodeURIComponent(postUrn)}/comments`, {
      params: {
        count: count || 10,
        start: start || 0,
      },
    });
  }

  /** Delete a comment */
  async deleteComment(postUrn: string, commentId: string): Promise<any> {
    return this.request<any>(
      `/socialActions/${encodeURIComponent(postUrn)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' }
    );
  }

  // --- Video Upload (REST API) ---

  /** Common headers for the LinkedIn REST Videos API (v202504) */
  private get videoApiHeaders(): Record<string, string> {
    return {
      'LinkedIn-Version': '202504',
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  private readonly REST_BASE = 'https://api.linkedin.com/rest';

  /** Initialize a video upload — returns video URN and upload URL */
  async initializeVideoUpload(ownerUrn: string, fileSizeBytes: number): Promise<any> {
    return this.request<any>('/videos', {
      method: 'POST',
      params: { action: 'initializeUpload' },
      body: {
        initializeUploadRequest: {
          owner: ownerUrn,
          fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      headers: this.videoApiHeaders,
      baseUrl: this.REST_BASE,
    });
  }

  /** Upload video binary to the URL from initializeVideoUpload. Returns the ETag. */
  async uploadVideoBinary(uploadUrl: string, videoData: Uint8Array): Promise<{ etag: string }> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(videoData.byteLength),
      },
      body: videoData as any as BodyInit,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkedIn Video Upload Error ${response.status}: ${text}`);
    }

    const etag = response.headers.get('ETag') || response.headers.get('etag') || '';
    return { etag };
  }

  /** Finalize a video upload after binary has been uploaded */
  async finalizeVideoUpload(videoUrn: string, etag: string): Promise<any> {
    return this.request<any>('/videos', {
      method: 'POST',
      params: { action: 'finalizeUpload' },
      body: {
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken: '',
          uploadedPartIds: [etag],
        },
      },
      headers: this.videoApiHeaders,
      baseUrl: this.REST_BASE,
    });
  }

  /** Get video processing status */
  async getVideoStatus(videoUrn: string): Promise<any> {
    return this.request<any>(`/videos/${encodeURIComponent(videoUrn)}`, {
      headers: this.videoApiHeaders,
      baseUrl: this.REST_BASE,
    });
  }

  /** Create a post with a video */
  async createVideoPost(params: {
    authorUrn: string;
    text: string;
    videoUrn: string;
    title?: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<any> {
    return this.request<any>('/posts', {
      method: 'POST',
      body: {
        author: params.authorUrn,
        commentary: params.text,
        visibility: params.visibility || 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            title: params.title || 'Video',
            id: params.videoUrn,
          },
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
      headers: this.videoApiHeaders,
      baseUrl: this.REST_BASE,
    });
  }
}
