export function validatePasswordStrength(password: unknown) {
  const value = String(password || '');
  if (value.length < 8) {
    return 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой';
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Нууц үг том үсэг, жижиг үсэг, тоо агуулсан байх ёстой';
  }
  return null;
}
