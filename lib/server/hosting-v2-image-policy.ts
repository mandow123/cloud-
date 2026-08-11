import { ExchangeDomainError, ExchangeInputError } from "./exchange-errors.ts";

export const HOSTING_V2_OCI_IMAGE_PATTERN = /^ghcr\.io\/kai-cloud\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u;

export function hostingV2ApprovedImages(environment: Record<string, string | undefined> = process.env) {
  const raw = environment.KAI_HOSTING_APPROVED_IMAGES?.trim() ?? "";
  if (!raw) throw new ExchangeDomainError("HOSTING_IMAGE_POLICY_UNAVAILABLE", 503, "平台尚未配置可交付的 OCI 镜像，挂牌保持关闭。");
  const images = raw.split(/[\n,]/u).map((value) => value.trim()).filter(Boolean);
  if (images.length === 0 || images.length > 20 || new Set(images).size !== images.length || images.some((image) => !HOSTING_V2_OCI_IMAGE_PATTERN.test(image))) {
    throw new ExchangeDomainError("HOSTING_IMAGE_POLICY_INVALID", 503, "平台 OCI 镜像策略无效，挂牌保持关闭。");
  }
  return new Set(images);
}

export function assertHostingV2ApprovedImage(image: string, environment: Record<string, string | undefined> = process.env) {
  if (!HOSTING_V2_OCI_IMAGE_PATTERN.test(image)) throw new ExchangeInputError("OCI 镜像必须使用 KAI 仓库的不可变 sha256 引用。", "approvedImage");
  if (!hostingV2ApprovedImages(environment).has(image)) throw new ExchangeInputError("只能选择平台当前批准的 OCI 镜像。", "approvedImage");
  return image;
}
