# Build the branded application

The application uses the official Postiz v2.25.3 backend and publishing workers. The custom Dockerfile rebuilds only the frontend using upstream's installed dependencies.

```sh
docker build -f deploy/postdelegate/Dockerfile.branding --build-arg SOURCE_REVISION=YOUR_SOURCE_REVISION -t postdelegate-postiz:custom .
```

The public URLs in the Dockerfile target this deployment. Change those URLs before building for another host. Supply runtime secrets separately; never copy credential files into the image.

The complete application source, modified assets, dependency lockfiles, license and this build recipe are available through the application's Source code link. Server-specific operations documentation and private files are not part of the public source archive.
