// Real navigation happens in RootLayout once rehydrate() resolves whether
// there's a valid session — redirecting here unconditionally would always
// flash the login screen first, even for an already-authenticated courier.
export default function Index() {
  return null;
}
