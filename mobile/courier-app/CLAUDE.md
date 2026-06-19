# Courier App — MEGAMALL

## Role
Курьер — получает заказы, обновляет статусы, сдаёт наличные.

## Stack
- Expo SDK 52 + Expo Router v4
- React Native 0.76
- expo-secure-store (токены хранятся безопасно, не в AsyncStorage)
- expo-location (геопозиция)
- expo-image-picker (фото квитанций и подтверждений)
- Zustand v4 (без persist — SecureStore вместо него)
- Axios с JWT auto-refresh interceptором

## Dev
```bash
npm install
npx expo start          # QR code для Expo Go
npx expo start --ios    # iOS симулятор
npx expo start --android # Android эмулятор
```

## Build (EAS)
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # APK для теста
eas build --platform android --profile production # AAB для Play Store
```

## Env
Скопируй `.env.example` → `.env` и замени IP на адрес сервера в локальной сети.
```
EXPO_PUBLIC_API_URL=http://192.168.1.100:8080
```

## Screens
| Маршрут | Экран | Описание |
|---|---|---|
| /(auth)/login | Login | Вход (только роль courier) |
| /(tabs)/dashboard | Dashboard | KPI + активные заказы |
| /(tabs)/deliveries | Deliveries | Список + обновление статуса + фото |
| /(tabs)/claimable | Claimable | Свободные заказы — взять |
| /(tabs)/cash | Cash | Сдача наличных + история |
| /(tabs)/profile | Profile | Инфо + выход |

## Auth Flow
1. login.jsx → POST /auth/login → получаем access_token + refresh_token
2. Токены сохраняются в expo-secure-store
3. При старте app/_layout.jsx вызывает rehydrate() — читает из SecureStore
4. При 401 — авто-refresh через queue в client.js

## Key Business Rules
- Курьер может взять только свободные заказы (статус: new, confirmed + не назначен)
- Для отметки "доставлен" обязательно фото (загружается на /uploads)
- Сдача наличных: сумма = все COD заказы за день − уже сданное
- Возврат: клиент не забрал / отказался
