# Use official Nginx image to serve static files
FROM nginx:alpine

# Set working directory inside the container
WORKDIR /usr/share/nginx/html

# Remove default Nginx static assets
RUN rm -rf ./*

# Copy project static files into Nginx web root
COPY index.html .
COPY style.css .
COPY script.js .
COPY config ./config


# Expose port 80 (Nginx default)
EXPOSE 80

# Nginx default command will run the web server
