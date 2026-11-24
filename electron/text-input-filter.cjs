'use strict'

// Bound native accessibility reads and the offline queue independently of the server's text rules.
const MAX_SAMPLE_LENGTH = 1000
const PLACEHOLDER = {
  secret: '[已脱敏:密钥]',
  token: '[已脱敏:Token]',
  bankCard: '[已脱敏:银行卡]',
  code: '[已脱敏:验证码]',
}

const passwordHintPattern =
  /(?:password|passwd|passphrase|\bpwd\b|pin码|密码|口令)/i

const verificationCodeHintPattern =
  /(?:验证码|校验码|动态码|短信码|安全码|图形码|动态口令|verification\s*code|verify\s*code|security\s*code|auth(?:entication)?\s*code|one[- ]?time|\botp\b|\b2fa\b|\bmfa\b|\btotp\b)/i

function codePointLength(text) {
  return Array.from(text).length
}

function isPasswordHint(hint) {
  return typeof hint === 'string' && passwordHintPattern.test(hint)
}

function isVerificationCodeHint(hint) {
  return typeof hint === 'string' && verificationCodeHintPattern.test(hint)
}

function passesLuhn(digits) {
  let sum = 0
  let doubleNext = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48
    if (digit < 0 || digit > 9) return false
    if (doubleNext) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleNext = !doubleNext
  }
  return sum % 10 === 0
}

function isLikelyBankCard(digits) {
  const len = digits.length
  if (len < 13 || len > 19 || !passesLuhn(digits)) return false
  if (/^0+$/.test(digits)) return false
  // Visa: 4... (13, 16, 19)
  if (digits.startsWith('4') && (len === 13 || len === 16 || len === 19)) return true
  // Mastercard: 51-55 or 2221-2720 (16)
  const prefix2 = Number(digits.slice(0, 2))
  const prefix4 = Number(digits.slice(0, 4))
  if (len === 16 && ((prefix2 >= 51 && prefix2 <= 55) || (prefix4 >= 2221 && prefix4 <= 2720))) {
    return true
  }
  // Amex: 34, 37 (15)
  if (len === 15 && (digits.startsWith('34') || digits.startsWith('37'))) return true
  // UnionPay (62), Discover (6011, 644-649, 65), JCB (3528-3589): 16-19
  if (
    len >= 16 &&
    len <= 19 &&
    (digits.startsWith('62') ||
      digits.startsWith('6011') ||
      digits.startsWith('65') ||
      (Number(digits.slice(0, 3)) >= 644 && Number(digits.slice(0, 3)) <= 649) ||
      (prefix4 >= 3528 && prefix4 <= 3589))
  ) {
    return true
  }
  return false
}

function isAlreadyRedacted(value) {
  return value.startsWith('[已脱敏:')
}

const secretPrefixPatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi,
  /\bsk-(?:proj-|ant-|live-|test-|svcacct-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{32,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  /\bhf_[A-Za-z0-9]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bLTAI[A-Za-z0-9]{12,}\b/g,
  /\bAKID[A-Za-z0-9]{20,}\b/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g,
]

function redactSensitiveText(text, options = {}) {
  let result = text

  // 1. Standalone verification code when the entire input is only a short numeric / hinted OTP code.
  if (
    /^\d{4,8}$/.test(result) ||
    /^\d{3}[\s-]\d{3}$/.test(result) ||
    /^\d(?:[\s-]\d){3,7}$/.test(result) ||
    (isVerificationCodeHint(options.hint) &&
      /^(?=[A-Za-z0-9]{4,8}$)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8}$/.test(result))
  ) {
    return PLACEHOLDER.code
  }

  // 2. JWT tokens.
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    PLACEHOLDER.token,
  )

  // 3. Well-known API keys & private key blocks.
  for (const pattern of secretPrefixPatterns) {
    result = result.replace(pattern, PLACEHOLDER.secret)
  }

  // 4. URL embedded credentials and sensitive query parameters.
  result = result.replace(
    /(https?:\/\/[^/\s:@]+:)([^/\s@]+)(@)/gi,
    (match, prefix, secret, suffix) =>
      isAlreadyRedacted(secret) ? match : prefix + PLACEHOLDER.secret + suffix,
  )
  result = result.replace(
    /([?&](access_token|refresh_token|id_token|auth_token|token|api_key|apikey|key|secret|auth|signature|sig|password|pwd)=)([^&\s#]+)/gi,
    (match, prefix, name, val) => {
      if (isAlreadyRedacted(val)) return match
      const isSecretParam = /^(?:api_?key|key|secret|password|pwd)$/i.test(name)
      return prefix + (isSecretParam ? PLACEHOLDER.secret : PLACEHOLDER.token)
    },
  )

  // 5. Authorization Bearer / Basic values.
  result = result.replace(
    /(\b(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]{12,})/gi,
    (match, prefix, val) => (isAlreadyRedacted(val) ? match : prefix + PLACEHOLDER.token),
  )

  // 6. Context-labeled tokens.
  result = result.replace(
    /(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|session[_-]?token|api[_-]?token|bearer[_-]?token|csrf[_-]?token|device[_-]?token|token)\s*(?:is\s+|[:=：]\s*))(['"]?)([^\s'",;，；。]{8,})\2/gi,
    (match, prefix, quote, val) =>
      isAlreadyRedacted(val) ? match : prefix + quote + PLACEHOLDER.token + quote,
  )
  result = result.replace(
    /((?:访问令牌|设备令牌|刷新令牌|令牌|凭证)\s*(?:是|为|[:=：])?\s*)([A-Za-z0-9._~+/=-]{8,})/g,
    (match, prefix, val) => (isAlreadyRedacted(val) ? match : prefix + PLACEHOLDER.token),
  )

  // 7. Context-labeled secrets / keys / passwords.
  result = result.replace(
    /(\b(?:api[_-]?key|api[_-]?secret|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|app[_-]?secret|auth[_-]?key|signing[_-]?key|encryption[_-]?key|secret|password|passwd|pwd|passphrase)\s*(?:is\s+|[:=：]\s*))(['"]?)([^\s'",;，；。]{4,})\2/gi,
    (match, prefix, quote, val) =>
      isAlreadyRedacted(val) ? match : prefix + quote + PLACEHOLDER.secret + quote,
  )
  result = result.replace(
    /((?:登录密码|支付密码|开机密码|密码|口令|密钥|秘钥|私钥|授权码)\s*(?:是|为|[:=：])?\s*)([A-Za-z0-9!@#$%^&*_+\-=~.?/]{4,64})/g,
    (match, prefix, val) => (isAlreadyRedacted(val) ? match : prefix + PLACEHOLDER.secret),
  )

  // 8. Context-labeled and Luhn-validated bank card numbers.
  result = result.replace(
    /((?:银行卡号?|信用卡号?|储蓄卡号?|借记卡号?|卡号|card\s*(?:no\.?|num(?:ber)?)?)\s*(?:是|为|[:=：])?\s*)((?:\d[\s-]?){13,19})(?!\d)/gi,
    (match, prefix, candidate) => {
      const trimmed = candidate.trimEnd()
      const trailing = candidate.slice(trimmed.length)
      const digits = trimmed.replace(/[\s-]/g, '')
      if (digits.length < 13 || digits.length > 19) return match
      return prefix + PLACEHOLDER.bankCard + trailing
    },
  )
  result = result.replace(
    /(?<!\d)((?:62|60|64|65|4\d|5[1-5]|2[2-7]|3[47]|35)(?:[\s-]?\d){11,17})(?!\d)/g,
    (match) => {
      const digits = match.replace(/[\s-]/g, '')
      return isLikelyBankCard(digits) ? PLACEHOLDER.bankCard : match
    },
  )

  // 9. Context-labeled verification codes.
  result = result.replace(
    /((?:短信|手机|邮箱|登录|动态|安全|图形)?(?:验证码|校验码|动态码|短信码|安全码|动态口令)[^\dA-Za-z\n]{0,6}?)(\d{4,8}|(?=[A-Za-z0-9]{4,8}(?![A-Za-z0-9]))(?=[A-Za-z0-9]*\d)[A-Z0-9]{4,8})(?![A-Za-z0-9])/g,
    (match, prefix, val) => (isAlreadyRedacted(val) ? match : prefix + PLACEHOLDER.code),
  )
  result = result.replace(
    /(?<![A-Za-z0-9])(\d{4,8})(\s*(?:是|为)?\s*(?:我的|你的|本次)?(?:短信|手机|邮箱|登录|动态)?(?:验证码|校验码|动态码|短信码))/g,
    (match, _val, suffix) => PLACEHOLDER.code + suffix,
  )
  result = result.replace(
    /(\b(?:verification\s*code|verify\s*code|security\s*code|auth(?:entication)?\s*code|passcode|otp|2fa|mfa|totp)\s*(?:is\s+|[:=：]\s*|\s+))(\d{4,8}|(?=[A-Za-z0-9]{4,8}\b)(?=[A-Za-z0-9]*\d)[A-Z0-9]{4,8})\b/gi,
    (match, prefix, val) => (isAlreadyRedacted(val) ? match : prefix + PLACEHOLDER.code),
  )

  // 10. Standalone high-entropy tokens (32+ chars, mixed case + digit or hex with letters + digits).
  result = result.replace(
    /(?<![/\w-])(?=[A-Za-z0-9_-]{32,})(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}(?![\w-])/g,
    PLACEHOLDER.token,
  )
  result = result.replace(
    /(?<![/\w-])(?=[0-9a-fA-F]{32,})(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{32,}(?![\w-])/g,
    PLACEHOLDER.token,
  )

  return result
}

function protectQueuedText(text, options) {
  const normalized = text.replace(/[\p{Cc}\p{Cs}\s]+/gu, ' ').trim()
  const redacted = redactSensitiveText(normalized, options)
  return redacted === normalized ? text : redacted
}

module.exports = {
  MAX_SAMPLE_LENGTH,
  PLACEHOLDER,
  codePointLength,
  isPasswordHint,
  isVerificationCodeHint,
  passesLuhn,
  isLikelyBankCard,
  redactSensitiveText,
  protectQueuedText,
}
