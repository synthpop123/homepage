import { glob } from "astro/loaders"
import { defineCollection, reference } from "astro:content"
import { z } from "astro/zod"

const authorSchema = z.object({
  name: z.string(),
  pronouns: z.string().optional(),
  avatar: z.url().or(z.string().startsWith("/")),
  bio: z.string().optional(),
  mail: z.email().optional(),
  socials: z.record(z.string(), z.url()).optional(),
})

const authors = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/authors",
  }),
  schema: authorSchema,
})

const friends = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/friends",
  }),
  schema: authorSchema,
})

const blog = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/blog",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      order: z.number().optional(),
      tags: z.array(z.string()).optional(),
      authors: z.array(reference("authors")),
      image: image().optional(),
      draft: z.boolean().optional(),
      mermaid: z.boolean().optional(),
      ai: z.boolean().optional(),
      // BCP 47. Leave it out and postLang() reads it from the body.
      lang: z
        .string()
        .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
        .optional(),
    }),
})

export const collections = { blog, authors, friends }
