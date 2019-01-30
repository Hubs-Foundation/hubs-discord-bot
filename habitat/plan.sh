pkg_name=hubs-discord-bot
pkg_origin=mozillareality
pkg_maintainer="Mozilla Mixed Reality <mixreality@mozilla.com>"

pkg_version="0.0.1"
pkg_license=('MPL2')
pkg_description="Discord bot for Hubs by Mozilla"
pkg_deps=(
  core/node/11.2.0
)

do_build() {
  npm ci
}

do_install() {
  for dir in node_modules package.json package-lock.json src
  do
    cp -R ./$dir "$pkg_prefix"
  done
}

do_strip() {
  return 0;
}
